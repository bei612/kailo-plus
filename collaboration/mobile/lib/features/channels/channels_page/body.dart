part of '../channels_page.dart';

class _ChannelsBody extends StatelessWidget {
  final List<Channel>? channels;
  final AsyncValue<List<Channel>> channelsAsync;
  final bool showError;
  final SessionStatus sessionStatus;
  final bool showConnectionSkeleton;
  final double topSectionHeight;
  final bool usesPinnedGradient;
  final ScrollController scrollController;
  final Future<void> Function() onRefresh;
  final Future<void> Function(Channel channel) onSelectChannel;

  const _ChannelsBody({
    required this.channels,
    required this.channelsAsync,
    required this.showError,
    required this.sessionStatus,
    required this.showConnectionSkeleton,
    required this.topSectionHeight,
    required this.usesPinnedGradient,
    required this.scrollController,
    required this.onRefresh,
    required this.onSelectChannel,
  });

  @override
  Widget build(BuildContext context) {
    final barHeight = topSectionHeight;
    final loadedChannels = channels;
    final loading =
        showConnectionSkeleton || (loadedChannels == null && !showError);
    final content = showError && channelsAsync.hasError
        ? Padding(
            padding: EdgeInsets.only(top: barHeight),
            child: _ErrorView(error: channelsAsync.error!, onRetry: onRefresh),
          )
        : loadedChannels == null
        ? const SizedBox.shrink()
        : BeeRefreshIndicator(
            edgeOffset: barHeight,
            onRefresh: onRefresh,
            child: CustomScrollView(
              controller: scrollController,
              // Transparent list gaps must remain hit-testable so a new drag
              // can interrupt ballistic scrolling. The app bar is painted
              // later and retains its community and profile controls.
              hitTestBehavior: HitTestBehavior.translucent,
              slivers: [
                SliverToBoxAdapter(child: SizedBox(height: barHeight)),
                if (usesPinnedGradient)
                  _SliverChannelsList(
                    channels: loadedChannels,
                    onSelectChannel: onSelectChannel,
                  )
                else
                  DecoratedSliver(
                    decoration: BoxDecoration(
                      color: context.colors.surface,
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(Radii.dialog),
                      ),
                    ),
                    sliver: _SliverChannelsList(
                      channels: loadedChannels,
                      onSelectChannel: onSelectChannel,
                    ),
                  ),
              ],
            ),
          );

    return SkeletonReveal(
      loading: loading,
      shimmerEnabled: sessionStatus != SessionStatus.disconnected,
      skeleton: _ChannelsSkeleton(
        channels: loadedChannels,
        topInset: barHeight,
        status: sessionStatus,
      ),
      content: content,
    );
  }
}

class _SliverChannelsList extends HookConsumerWidget {
  final List<Channel> channels;
  final Future<void> Function(Channel channel) onSelectChannel;

  const _SliverChannelsList({
    required this.channels,
    required this.onSelectChannel,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final readState = ref.watch(readStateProvider);
    final preferences = ref.watch(collaborationPreferencesProvider);
    // DD-150(3): custom sections are the Core `sidebar_sections` readback.
    final sectionsState = ref.watch(channelSectionsProvider);
    // DD-150(3): original per-group sort, the Core `sidebar_sort` readback.
    final sortState = ref.watch(channelSortProvider);
    final collapsedSections = useState<Set<String>>(const {});
    final visibleChannels = channels
        .where((channel) => channel.isMember && !channel.isArchived)
        .toList();

    final starredExpanded = useState(true);
    final channelsExpanded = useState(true);
    final dmsExpanded = useState(true);
    final pubkey = ref.watch(myPubkeyProvider);
    int dmByLabel(Channel left, Channel right) => left
        .displayLabel(currentPubkey: pubkey)
        .toLowerCase()
        .compareTo(right.displayLabel(currentPubkey: pubkey).toLowerCase());
    // DMs default to the display-label alphabetical order (labels can differ
    // from channel names); Recent reorders by last message time.
    final dmChannels = sortChannelsForList(
      visibleChannels.where((channel) => channel.isDm).toList(),
      sortState.sortModeFor(kSortGroupDms),
      byName: dmByLabel,
    );
    final streamChannels = visibleChannels
        .where((channel) => !channel.isDm)
        .toList();
    // Original Starred is exclusive and stream-only. A DM never moves here.
    final starredStreamChannels = sortChannelsForList(
      streamChannels
          .where(
            (channel) =>
                channel.channelType == 'stream' &&
                preferences.starred(channel.id) == true,
          )
          .toList(),
      sortState.sortModeFor(kSortGroupStarred),
    );
    final unstarredStreamChannels = streamChannels
        .where(
          (channel) =>
              channel.channelType != 'stream' ||
              preferences.starred(channel.id) != true,
        )
        .toList();
    // Original grouping: Starred wins, then the assigned custom section, then
    // the default Channels group.
    final userSections = sectionsState.sections;
    final liveSectionIds = [for (final section in userSections) section.id];
    List<Channel> sectionChannels(String sectionId) => sortChannelsForList(
      unstarredStreamChannels
          .where((channel) => sectionsState.sectionOf(channel.id) == sectionId)
          .toList(),
      sortState.sortModeFor(sectionSortGroupKey(sectionId)),
    );
    final ungroupedStreamChannels = sortChannelsForList(
      unstarredStreamChannels
          .where((channel) => sectionsState.sectionOf(channel.id) == null)
          .toList(),
      sortState.sortModeFor(kSortGroupChannels),
    );
    final starredLabel = _channelText(
      context,
      PlatformMessageKey.sidebarStarred,
    );
    final channelsLabel = _channelText(
      context,
      PlatformMessageKey.sidebarChannels,
    );
    final dmLabel = _channelText(context, PlatformMessageKey.nativeDmSection);
    final initialSeedComplete = useState(false);
    final seededPubkey = useRef<String?>(null);
    final seedCompleteForPubkey =
        seededPubkey.value == readState.pubkey && initialSeedComplete.value;

    useEffect(() {
      if (!readState.isReady) {
        return null;
      }

      return deferReadStateUpdate(context, () {
        if (seededPubkey.value != readState.pubkey) {
          seededPubkey.value = readState.pubkey;
          initialSeedComplete.value = false;
        }

        if (initialSeedComplete.value) {
          return;
        }

        final notifier = ref.read(readStateProvider.notifier);
        for (final channel in visibleChannels) {
          if (readState.effectiveTimestamp(channel.id) != null) {
            continue;
          }

          final lastMessageAt = dateTimeToUnixSeconds(channel.lastMessageAt);
          if (lastMessageAt != null) {
            notifier.seedContextRead(channel.id, lastMessageAt);
          }
        }
        initialSeedComplete.value = true;
      });
    }, [readState.isReady, readState.pubkey, visibleChannels]);

    final unreadState = _computeUnreadChannelState(
      channels: visibleChannels,
      readState: readState,
      channelsNotifier: ref.read(channelsProvider.notifier),
    );
    final unreadChannelIds = {
      for (final channelId in unreadState.ids)
        if (seedCompleteForPubkey ||
            readState.effectiveTimestamp(channelId) != null)
          channelId,
    };

    return SliverPadding(
      padding: EdgeInsets.only(
        top: Grid.xxs,
        bottom: MediaQuery.paddingOf(context).bottom,
      ),
      sliver: SliverList.list(
        children: [
          if (visibleChannels.isEmpty)
            const _EmptyState()
          else ...[
            if (starredStreamChannels.isNotEmpty)
              _ChannelSection(
                title: starredLabel,
                icon: LucideIcons.star,
                menu: sortState.writable
                    ? _SortMenu(
                        groupKey: kSortGroupStarred,
                        label: starredLabel,
                        mode: sortState.sortModeFor(kSortGroupStarred),
                      )
                    : null,
                showTopDivider: false,
                expanded: starredExpanded.value,
                onToggle: () => starredExpanded.value = !starredExpanded.value,
                channels: starredStreamChannels,
                unreadChannelIds: unreadChannelIds,
                emptyLabel: '',
                onSelectChannel: onSelectChannel,
              ),
            for (final section in userSections)
              _ChannelSection(
                key: ValueKey('channel-user-section-${section.id}'),
                title: section.name,
                icon: LucideIcons.folder,
                emoji: section.icon,
                showTopDivider:
                    starredStreamChannels.isNotEmpty ||
                    userSections.first.id != section.id,
                expanded: !collapsedSections.value.contains(section.id),
                onToggle: () {
                  final next = {...collapsedSections.value};
                  if (!next.remove(section.id)) next.add(section.id);
                  collapsedSections.value = next;
                },
                channels: sectionChannels(section.id),
                unreadChannelIds: unreadChannelIds,
                emptyLabel: '',
                onSelectChannel: onSelectChannel,
                menu: sectionsState.writable
                    ? _UserSectionMenu(
                        section: section,
                        channelCount: sectionChannels(section.id).length,
                        isFirst: userSections.first.id == section.id,
                        isLast: userSections.last.id == section.id,
                        sortMode: sortState.sortModeFor(
                          sectionSortGroupKey(section.id),
                        ),
                        liveSectionIds: liveSectionIds,
                      )
                    : null,
              ),
            _ChannelSection(
              title: channelsLabel,
              icon: LucideIcons.hash,
              menu: sortState.writable
                  ? _SortMenu(
                      groupKey: kSortGroupChannels,
                      label: channelsLabel,
                      mode: sortState.sortModeFor(kSortGroupChannels),
                    )
                  : null,
              showTopDivider:
                  starredStreamChannels.isNotEmpty || userSections.isNotEmpty,
              expanded: channelsExpanded.value,
              onToggle: () => channelsExpanded.value = !channelsExpanded.value,
              channels: ungroupedStreamChannels,
              unreadChannelIds: unreadChannelIds,
              emptyLabel: 'No channels yet',
              onSelectChannel: onSelectChannel,
            ),
          ],
          if (dmChannels.isNotEmpty)
            _ChannelSection(
              title: dmLabel,
              icon: LucideIcons.messagesSquare,
              menu: sortState.writable
                  ? _SortMenu(
                      groupKey: kSortGroupDms,
                      label: dmLabel,
                      mode: sortState.sortModeFor(kSortGroupDms),
                    )
                  : null,
              expanded: dmsExpanded.value,
              showTopDivider: true,
              onToggle: () => dmsExpanded.value = !dmsExpanded.value,
              channels: dmChannels,
              unreadChannelIds: unreadChannelIds,
              emptyLabel: _channelText(context, PlatformMessageKey.dmEmpty),
              onSelectChannel: onSelectChannel,
            ),
        ],
      ),
    );
  }
}
