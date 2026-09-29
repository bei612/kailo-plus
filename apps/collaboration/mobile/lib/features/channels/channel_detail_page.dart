import 'dart:async';
import 'dart:math' show max, min;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show ScrollDirection;
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:scrollable_positioned_list/scrollable_positioned_list.dart';

import '../../shared/mentions/agent_identity_provider.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../../shared/widgets/keyboard_dismiss_on_drag.dart';
import '../../shared/widgets/ios_glass_navigation_button.dart';
import '../../shared/widgets/message_author_meta.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import 'android_ime_lift.dart';
import 'channel.dart';
import 'channel_actions_sheet.dart';
import 'channel_link_navigation.dart';
import 'channel_management_provider.dart';
import 'channel_messages_provider.dart';
import 'channels_provider.dart';
import 'unread_badge/observed_unread_event.dart';
import 'compose_bar.dart';
import 'composer_dock_size_reporter.dart';
import 'date_formatters.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'day_divider.dart';
import 'ime_metrics_settle_observer.dart';
import 'jump_to_latest_button.dart';
import 'jump_to_latest_switcher.dart';
import 'local_message_send_animation_provider.dart';
import 'local_message_send_transition.dart';
import 'message_actions.dart';
import 'message_action_backdrop_state.dart';
import 'message_long_press_region.dart';
import 'message_content.dart';
import '../../shared/read_state/deferred_read_state_update.dart';
import '../../shared/read_state/read_state_format.dart';
import '../../shared/read_state/read_state_provider.dart';
import '../../shared/read_state/read_state_time.dart';
import '../../shared/platform/platform_views.dart';
import '../platform/platform_members_page.dart';
import 'send_message_provider.dart';
import '../profile/user_profile_sheet.dart';
import 'small_avatar.dart';
import 'sticky_date_header.dart';
import 'thread_detail_page.dart';
import 'timeline_message.dart';

part 'channel_detail_page/message_list.dart';
part 'channel_detail_page/system_rows.dart';
part 'channel_detail_page/message_bubble.dart';
part 'channel_detail_page/banners.dart';
part 'channel_detail_page/app_bar.dart';

/// Fetch deep-link targets that may be outside the loaded channel window.
Future<void> _loadDeepLinkEvents(
  WidgetRef ref,
  String channelId,
  Set<String> eventIds,
) async {
  try {
    await ref
        .read(channelMessagesProvider(channelId).notifier)
        .loadEventsById(eventIds);
  } catch (error) {
    debugPrint('deep-link: failed to load target messages: $error');
  }
}

int? _channelReadTimestamp({
  required Channel channel,
  required AsyncValue<List<NostrEvent>> messagesState,
}) {
  final events = messagesState.value;
  if (events != null && events.isNotEmpty) {
    var latest = 0;
    for (final event in events) {
      if (event.threadReference.parentId != null) continue;
      if (event.createdAt > latest) {
        latest = event.createdAt;
      }
    }
    if (latest > 0) {
      return latest;
    }
  }

  return dateTimeToUnixSeconds(channel.lastMessageAt);
}

/// Controls how a hydrated initial thread is added to the navigation stack.
enum InitialThreadRouteBehavior {
  /// Keep the channel route beneath the thread.
  push,

  /// Replace the temporary channel route so Back returns to its origin.
  replaceCurrentRoute,
}

class ChannelDetailPage extends HookConsumerWidget {
  final Channel channel;
  final String? initialMessageId;
  final String? initialThreadRootId;

  /// How the automatically opened initial thread affects the route stack.
  final InitialThreadRouteBehavior initialThreadRouteBehavior;

  const ChannelDetailPage({
    super.key,
    required this.channel,
    this.initialMessageId,
    this.initialThreadRootId,
    this.initialThreadRouteBehavior = InitialThreadRouteBehavior.push,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final composerDockHeight = useState(0.0);
    final composerFocusNode = useFocusNode();
    final restoreComposerFocus = useRef<VoidCallback?>(null);
    final sendMessage = ref.read(sendMessageProvider);
    final detailsAsync = ref.watch(channelDetailsProvider(channel.id));
    final channelsAsync = ref.watch(channelsProvider);
    final messagesState = ref.watch(channelMessagesProvider(channel.id));
    final sessionStatus = ref.watch(relaySessionProvider).status;
    final readState = ref.watch(readStateProvider);
    final channelsNotifier = ref.read(channelsProvider.notifier);
    final initialOrdinaryUnreadMessageIdsRef = useRef<Set<String>>(const {});
    final initialOldestOrdinaryUnreadMessageIdRef = useRef<String?>(null);
    final initialForcedUnreadMessageIdsRef = useRef<Set<String>>(const {});
    final didCaptureInitialReadAt = useRef(false);
    if (readState.isReady && !didCaptureInitialReadAt.value) {
      final channelReadAt = readState.effectiveTimestamp(channel.id);
      final ordinaryUnreadEvents = [
        for (final event
            in channelsNotifier
                    .observedUnreadEventsByChannel[channel.id]
                    ?.values ??
                const <ObservedUnreadEvent>[])
          if (event.rootId == null &&
              event.createdAt >
                  (observedUnreadEventReadAt(
                        event,
                        channelReadAt,
                        (rootId) => readState.effectiveTimestamp(
                          threadContextKey(rootId),
                        ),
                        (messageId) => readState.effectiveTimestamp(
                          msgContextKey(messageId),
                        ),
                      ) ??
                      0))
            event,
      ]..sort((a, b) => a.createdAt.compareTo(b.createdAt));
      initialOrdinaryUnreadMessageIdsRef.value = {
        for (final event in ordinaryUnreadEvents) event.id,
      };
      initialOldestOrdinaryUnreadMessageIdRef.value =
          ordinaryUnreadEvents.firstOrNull?.id;
      initialForcedUnreadMessageIdsRef.value = {
        for (final entry in readState.forcedUnreadContexts.entries)
          if (entry.value == channel.id && entry.key.startsWith('msg:'))
            entry.key.substring('msg:'.length),
      };
      didCaptureInitialReadAt.value = true;
    }
    final initialOrdinaryUnreadMessageIds =
        initialOrdinaryUnreadMessageIdsRef.value;
    final initialOldestOrdinaryUnreadMessageId =
        initialOldestOrdinaryUnreadMessageIdRef.value;
    final initialForcedUnreadMessageIds =
        initialForcedUnreadMessageIdsRef.value;
    final currentPubkey = ref.watch(currentPubkeyProvider);
    // 作者名取自 Kailo 成员名单：原生设备的公钥没有 kind:0 资料（DD-77）
    ref.watch(kailoAuthorNamesProvider(channel.id));
    final baseChannel =
        channelsAsync
            .whenData(
              (channels) => channels.firstWhere(
                (candidate) => candidate.id == channel.id,
                orElse: () => channel,
              ),
            )
            .value ??
        channel;
    final resolvedChannel =
        detailsAsync.whenData(baseChannel.mergeDetails).value ?? baseChannel;
    final showsComposer =
        resolvedChannel.isMember && !resolvedChannel.isArchived;
    final messagesNotifier = ref.read(
      channelMessagesProvider(channel.id).notifier,
    );
    final isConnectionInProgress =
        sessionStatus == SessionStatus.connecting ||
        sessionStatus == SessionStatus.reconnecting;
    final showConnectionSkeleton = useState(false);
    final shouldDebounceConnectionSkeleton =
        isConnectionInProgress && messagesNotifier.hasLoadedMessages;
    useEffect(() {
      if (!shouldDebounceConnectionSkeleton) {
        showConnectionSkeleton.value = false;
        return null;
      }
      final timer = Timer(const Duration(seconds: 2), () {
        showConnectionSkeleton.value = true;
      });
      return timer.cancel;
    }, [shouldDebounceConnectionSkeleton]);
    final showInitialConnectionSkeleton =
        isConnectionInProgress && !messagesNotifier.hasLoadedMessages;
    final appBarTitleContentHeight = _twoLineAppBarTitleContentHeight(context);
    final usesNativeIosGlassBackButton =
        Navigator.canPop(context) &&
        Theme.of(context).platform == TargetPlatform.iOS;
    final readTimestamp = _channelReadTimestamp(
      channel: resolvedChannel,
      messagesState: messagesState,
    );

    useEffect(() {
      final session = ref.read(relaySessionProvider.notifier);
      return session.registerVisibleChannel(channel.id);
    }, [channel.id]);

    useEffect(
      () {
        final eventIds = {
          ?initialMessageId,
          ?initialThreadRootId,
          ?initialOldestOrdinaryUnreadMessageId,
          ...initialForcedUnreadMessageIds,
        };
        if (eventIds.isEmpty) return null;
        final notifier = ref.read(channelMessagesProvider(channel.id).notifier);
        unawaited(_loadDeepLinkEvents(ref, channel.id, eventIds));
        return () => notifier.releaseDeepLinkEvents(eventIds);
      },
      [
        channel.id,
        initialMessageId,
        initialThreadRootId,
        initialOldestOrdinaryUnreadMessageId,
        initialForcedUnreadMessageIds,
      ],
    );

    useEffect(() {
      if (!readState.isReady || readTimestamp == null) {
        return null;
      }
      return deferReadStateUpdate(context, () {
        ref
            .read(readStateProvider.notifier)
            .markContextRead(channel.id, readTimestamp);
        ref
            .read(channelsProvider.notifier)
            .clearObservedUnreadCoveredByRead(channel.id, readTimestamp);
      });
    }, [channel.id, readState.isReady, readTimestamp]);

    return FrostedScaffold(
      resizeToAvoidBottomInset: !usesFixedAndroidImeViewport,
      appBar: FrostedAppBar(
        leading: usesNativeIosGlassBackButton
            ? IosGlassNavigationButton(
                key: const ValueKey('channel-ios-glass-back'),
                icon: IosGlassNavigationIcon.back,
                semanticLabel: 'Back',
                onPressed: () => Navigator.of(context).maybePop(),
                width: iosGlassChannelHeaderLeadingWidth,
                buttonCenterX: iosGlassChannelHeaderButtonCenterX,
                nativeViewSuppressed: messageActionBackdropActive,
              )
            : null,
        iconColor: context.colors.primary,
        titleContentHeight: appBarTitleContentHeight,
        titleStyle: channelTitleTextStyle,
        title: Padding(
          padding: EdgeInsets.only(
            left: usesNativeIosGlassBackButton
                ? iosGlassChannelHeaderTitleSpacing
                : 0,
          ),
          child: _ChannelAppBarTitle(
            channel: resolvedChannel,
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => KailoMembersPage(
                  workspaceId: resolvedChannel.id,
                  title: resolvedChannel.name,
                ),
              ),
            ),
          ),
        ),
        actions: [
          IconButton(
            color: context.colors.primary,
            onPressed: () => showChannelActionsSheet(
              context: context,
              channel: resolvedChannel,
              isUnread: false,
            ),
            tooltip: 'Channel actions',
            icon: const Icon(LucideIcons.ellipsisVertical, size: 22),
          ),
        ],
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          Column(
            children: [
              Expanded(
                child: SkeletonReveal(
                  loading:
                      showInitialConnectionSkeleton ||
                      showConnectionSkeleton.value ||
                      messagesState.isLoading,
                  shimmerEnabled: sessionStatus != SessionStatus.disconnected,
                  skeleton: _MessageTimelineSkeleton(
                    appBarTitleContentHeight: appBarTitleContentHeight,
                    status: sessionStatus,
                  ),
                  content: messagesState.when(
                    loading: SizedBox.shrink,
                    error: (e, _) => Padding(
                      padding: EdgeInsets.only(
                        top: frostedAppBarHeight(
                          context,
                          titleContentHeight: appBarTitleContentHeight,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          'Failed to load messages',
                          style: context.textTheme.bodyMedium?.copyWith(
                            color: context.colors.error,
                          ),
                        ),
                      ),
                    ),
                    data: (events) {
                      final messages = formatTimeline(events);
                      final summaries = ref
                          .read(channelMessagesProvider(channel.id).notifier)
                          .threadSummaries;
                      final entries = buildMainTimelineEntries(
                        messages,
                        relaySummaries: summaries,
                      );
                      return _MessageList(
                        entries: entries,
                        allMessages: messages,
                        initialMessageId: initialMessageId,
                        initialThreadRootId: initialThreadRootId,
                        initialThreadRouteBehavior: initialThreadRouteBehavior,
                        initialOrdinaryUnreadMessageIds:
                            initialOrdinaryUnreadMessageIds,
                        initialOldestOrdinaryUnreadMessageId:
                            initialOldestOrdinaryUnreadMessageId,
                        initialForcedUnreadMessageIds:
                            initialForcedUnreadMessageIds,
                        hasInitialUnread:
                            readState.isReady &&
                            (readState.isForcedUnread(channel.id) ||
                                initialForcedUnreadMessageIds.isNotEmpty ||
                                initialOldestOrdinaryUnreadMessageId != null),
                        channelId: channel.id,
                        currentPubkey: currentPubkey,
                        isMember: resolvedChannel.isMember,
                        isArchived: resolvedChannel.isArchived,
                        appBarTitleContentHeight: appBarTitleContentHeight,
                        composerBottomInset: showsComposer
                            ? composerDockHeight.value
                            : 0,
                        composerFocusNode: showsComposer
                            ? composerFocusNode
                            : null,
                        restoreComposerFocus: showsComposer
                            ? () => restoreComposerFocus.value?.call()
                            : null,
                      );
                    },
                  ),
                ),
              ),
              if (!showsComposer) _ReadOnlyNotice(channel: resolvedChannel),
            ],
          ),
          if (showsComposer)
            AndroidImeLift(
              child: Align(
                alignment: Alignment.bottomCenter,
                child: ComposerDockSizeReporter(
                  key: const ValueKey('channel-composer-dock'),
                  onHeightChanged: (height) {
                    if ((composerDockHeight.value - height).abs() < 0.5) return;
                    composerDockHeight.value = height;
                  },
                  // 高度随内容收缩：dock 只量 composer 本身
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ComposeBar(
                        channelId: channel.id,
                        focusNode: composerFocusNode,
                        onFocusRestorerChanged: (restoreFocus) =>
                            restoreComposerFocus.value = restoreFocus,
                        channelName: resolvedChannel.name,
                        onSend:
                            (
                              content,
                              mentionPubkeys, {
                              mediaTags = const <List<String>>[],
                            }) => sendMessage.call(
                              channelId: channel.id,
                              content: content,
                              mentionPubkeys: mentionPubkeys,
                              mediaTags: mediaTags,
                            ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
