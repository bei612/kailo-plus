import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/clipboard_utils.dart';
import '../../shared/read_state/read_state_provider.dart';
import '../../shared/read_state/read_state_time.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../platform/platform_members_page.dart';
import 'channel.dart';
import 'channels_provider.dart';
import 'direct_messages.dart';

/// Opens the mobile channel actions sheet.
///
/// 此 sheet 提供频道收藏、已读/未读、私聊静音、频道成员名单与复制；频道创建和
/// New DM 由原 launcher 发起。其余频道/DM 管理仍未恢复，不生成假入口。
Future<void> showChannelActionsSheet({
  required BuildContext context,
  required Channel channel,
  required bool isUnread,
  VoidCallback? onMarkRead,
}) => showBuzzModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  constraints: BoxConstraints(
    maxWidth: 640,
    maxHeight: MediaQuery.sizeOf(context).height * 0.7,
  ),
  builder: (_) => ChannelActionsSheet(
    channel: channel,
    isUnread: isUnread,
    onMarkRead: onMarkRead,
  ),
);

/// Mobile action sheet for channel-level read and reference operations.
class ChannelActionsSheet extends HookConsumerWidget {
  const ChannelActionsSheet({
    super.key,
    required this.channel,
    required this.isUnread,
    this.onMarkRead,
  });

  final Channel channel;
  final bool isUnread;
  final VoidCallback? onMarkRead;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    void close() => Navigator.of(context).pop();
    final currentConsumer = ref.watch(directMessagesProvider).asData?.value;
    final originalConsumer = useRef<DirectMessages?>(null);
    if (originalConsumer.value == null && currentConsumer != null) {
      originalConsumer.value = currentConsumer;
    }
    final ownsConsumer =
        currentConsumer != null &&
        identical(originalConsumer.value, currentConsumer);
    useEffect(() {
      if (originalConsumer.value != null && !ownsConsumer) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (context.mounted && Navigator.of(context).canPop()) close();
        });
      }
      return null;
    }, [currentConsumer]);
    final preferenceState = ref.watch(collaborationPreferencesProvider);
    final muted = ownsConsumer ? preferenceState.muted(channel.id) : null;
    final starred = ownsConsumer && channel.channelType == 'stream'
        ? preferenceState.starred(channel.id)
        : null;
    String text(PlatformMessageKey key) =>
        platformText(key, locale: Localizations.localeOf(context).languageCode);

    final readBusy = useState(false);
    final readUnconfirmed = useState(false);
    final readState = ref.watch(readStateProvider);
    Future<void> toggleRead() async {
      if (readBusy.value || !ownsConsumer || !readState.isReady) return;
      final timestamp = dateTimeToUnixSeconds(channel.lastMessageAt);
      if (isUnread) {
        if (timestamp != null) {
          readBusy.value = true;
          final confirmed = await ref
              .read(readStateProvider.notifier)
              .markContextReadConfirmed(channel.id, timestamp);
          if (!context.mounted ||
              !identical(
                ref.read(directMessagesProvider).asData?.value,
                originalConsumer.value,
              )) {
            return;
          }
          readBusy.value = false;
          if (!confirmed) {
            readUnconfirmed.value = true;
            return;
          }
          onMarkRead?.call();
          ref
              .read(channelsProvider.notifier)
              .clearObservedUnreadCoveredByRead(channel.id, timestamp);
          close();
        }
      } else {
        ref
            .read(readStateProvider.notifier)
            .markContextUnread(channel.id, channelId: channel.id);
        close();
      }
    }

    return SafeArea(
      top: false,
      child: IconTheme.merge(
        data: const IconThemeData(size: 22),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
            Grid.gutter,
            0,
            Grid.gutter,
            Grid.xs,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (channel.channelType == 'stream') ...[
                _ChannelQuickActionsRow(
                  isStarred: starred == true,
                  isUnread: isUnread,
                  onToggleRead:
                      ownsConsumer && readState.isReady && !readBusy.value
                      ? toggleRead
                      : null,
                  onToggleStar:
                      starred == null ||
                          preferenceState.busy ||
                          preferenceState.pendingId != null
                      ? null
                      : () async {
                          await ref
                              .read(collaborationPreferencesProvider.notifier)
                              .setStarred(channel.id, !starred);
                          if (context.mounted &&
                              ref
                                      .read(collaborationPreferencesProvider)
                                      .starred(channel.id) ==
                                  !starred &&
                              ref
                                      .read(collaborationPreferencesProvider)
                                      .pendingId ==
                                  null) {
                            close();
                          }
                        },
                ),
                const SizedBox(height: Grid.xs),
                if (preferenceState.busy ||
                    preferenceState.pendingId != null ||
                    starred == null)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      text(
                        preferenceState.pendingId != null
                            ? PlatformMessageKey.sidebarPreferenceUnknown
                            : PlatformMessageKey.platformLoadFailed,
                      ),
                    ),
                    trailing: preferenceState.busy
                        ? const SizedBox.square(
                            dimension: 22,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : IconButton(
                            tooltip: text(
                              preferenceState.pendingId != null
                                  ? PlatformMessageKey.dmCheckStatus
                                  : PlatformMessageKey.platformRefresh,
                            ),
                            icon: const Icon(LucideIcons.refreshCw),
                            onPressed: () => ref
                                .read(collaborationPreferencesProvider.notifier)
                                .recheck(),
                          ),
                  ),
              ],
              if (!readState.isReady ||
                  readBusy.value ||
                  readUnconfirmed.value ||
                  readState.pendingContextId == channel.id)
                ListTile(
                  key: const ValueKey('channel-read-unconfirmed'),
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    text(
                      readState.isReady
                          ? PlatformMessageKey.sidebarPreferenceUnknown
                          : PlatformMessageKey.platformLoadFailed,
                    ),
                  ),
                  trailing: readBusy.value
                      ? const SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : IconButton(
                          tooltip: text(PlatformMessageKey.dmCheckStatus),
                          icon: const Icon(LucideIcons.refreshCw),
                          onPressed: !ownsConsumer
                              ? null
                              : readState.isReady
                              ? toggleRead
                              : () => ref
                                    .read(readStateProvider.notifier)
                                    .recheck(),
                        ),
                ),
              if (channel.channelType != 'stream')
                ListTile(
                  key: const ValueKey('channel-action-read'),
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    isUnread ? LucideIcons.checkCheck : LucideIcons.circleDot,
                  ),
                  title: Text(isUnread ? 'Mark read' : 'Mark unread'),
                  onTap: ownsConsumer && readState.isReady && !readBusy.value
                      ? toggleRead
                      : null,
                ),
              if (channel.isDm)
                ListTile(
                  key: const ValueKey('channel-action-mute'),
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    muted == true ? LucideIcons.bell : LucideIcons.bellOff,
                  ),
                  title: Text(
                    text(
                      muted == true
                          ? PlatformMessageKey.sidebarUnmute
                          : PlatformMessageKey.sidebarMute,
                    ),
                  ),
                  subtitle: preferenceState.pendingId != null
                      ? Text(text(PlatformMessageKey.sidebarPreferenceUnknown))
                      : preferenceState.error != null
                      ? Text(text(PlatformMessageKey.platformLoadFailed))
                      : null,
                  trailing: preferenceState.busy
                      ? const SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : muted == null || preferenceState.pendingId != null
                      ? IconButton(
                          tooltip: text(
                            preferenceState.pendingId != null
                                ? PlatformMessageKey.dmCheckStatus
                                : PlatformMessageKey.platformRefresh,
                          ),
                          icon: const Icon(LucideIcons.refreshCw),
                          onPressed: () => ref
                              .read(collaborationPreferencesProvider.notifier)
                              .recheck(),
                        )
                      : null,
                  onTap:
                      muted == null ||
                          preferenceState.busy ||
                          preferenceState.pendingId != null
                      ? null
                      : () async {
                          await ref
                              .read(collaborationPreferencesProvider.notifier)
                              .setMuted(channel.id, !muted);
                          if (context.mounted &&
                              ref
                                      .read(collaborationPreferencesProvider)
                                      .muted(channel.id) ==
                                  !muted &&
                              ref
                                      .read(collaborationPreferencesProvider)
                                      .pendingId ==
                                  null) {
                            close();
                          }
                        },
                ),
              if (!channel.isDm)
                ListTile(
                  key: const ValueKey('channel-action-members'),
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(LucideIcons.users),
                  title: const Text('Members'),
                  onTap: () {
                    final navigator = Navigator.of(context);
                    close();
                    navigator.push(
                      MaterialPageRoute<void>(
                        builder: (_) => PlatformMembersPage(
                          workspaceId: channel.id,
                          title: channel.name,
                        ),
                      ),
                    );
                  },
                ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(LucideIcons.copy),
                title: const Text('Copy channel name'),
                onTap: () {
                  close();
                  copyToClipboard(
                    context,
                    channel.name,
                    message: 'Channel name copied to clipboard',
                  );
                },
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(LucideIcons.hash),
                title: const Text('Copy channel ID'),
                onTap: () {
                  close();
                  copyToClipboard(
                    context,
                    channel.id,
                    message: 'Channel ID copied to clipboard',
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// Original Buzz quick-action row; only its preference authority and translated
// labels differ. An unavailable Core read disables Star, not an optimistic write.
class _ChannelQuickActionsRow extends StatelessWidget {
  const _ChannelQuickActionsRow({
    required this.isStarred,
    required this.isUnread,
    required this.onToggleStar,
    required this.onToggleRead,
  });
  final bool isStarred;
  final bool isUnread;
  final VoidCallback? onToggleStar;
  final VoidCallback? onToggleRead;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: _ChannelQuickAction(
          key: const ValueKey('channel-action-star'),
          icon: isStarred ? LucideIcons.starOff : LucideIcons.star,
          label: platformText(
            isStarred
                ? PlatformMessageKey.nativeChannelUnstar
                : PlatformMessageKey.nativeChannelStar,
            locale: Localizations.localeOf(context).toLanguageTag(),
          ),
          onTap: onToggleStar,
        ),
      ),
      const SizedBox(width: Grid.twelve),
      Expanded(
        child: _ChannelQuickAction(
          key: const ValueKey('channel-action-read'),
          icon: isUnread ? LucideIcons.checkCheck : LucideIcons.circleDot,
          label: platformText(
            isUnread
                ? PlatformMessageKey.nativeChannelMarkRead
                : PlatformMessageKey.nativeChannelMarkUnread,
            locale: Localizations.localeOf(context).toLanguageTag(),
          ),
          onTap: onToggleRead,
        ),
      ),
    ],
  );
}

class _ChannelQuickAction extends StatelessWidget {
  const _ChannelQuickAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap == null
        ? null
        : () {
            unawaited(HapticFeedback.lightImpact());
            onTap!();
          },
    behavior: HitTestBehavior.opaque,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          height: 68 + (Grid.xxs * 2),
          decoration: BoxDecoration(
            color: context.colors.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(Radii.dialog),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 22, color: context.colors.onSurface),
              const SizedBox(height: Grid.xxs),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.textTheme.labelMedium?.copyWith(
                  color: context.colors.onSurface,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
