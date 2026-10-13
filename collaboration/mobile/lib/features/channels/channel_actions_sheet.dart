import 'package:flutter/material.dart';
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
/// 此 sheet 提供已读/未读、私聊静音、频道成员名单与复制；受治理的频道创建和
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
    final currentConsumer = channel.isDm
        ? ref.watch(directMessagesProvider).asData?.value
        : null;
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
    final muteState = channel.isDm ? ref.watch(conversationMuteProvider) : null;
    final muted = ownsConsumer ? muteState?.muted(channel.id) : null;
    String text(PlatformMessageKey key) =>
        platformText(key, locale: Localizations.localeOf(context).languageCode);

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
              ListTile(
                key: const ValueKey('channel-action-read'),
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  isUnread ? LucideIcons.checkCheck : LucideIcons.circleDot,
                ),
                title: Text(isUnread ? 'Mark read' : 'Mark unread'),
                onTap: () {
                  close();
                  final timestamp = dateTimeToUnixSeconds(
                    channel.lastMessageAt,
                  );
                  if (isUnread) {
                    onMarkRead?.call();
                    if (timestamp != null) {
                      ref
                          .read(readStateProvider.notifier)
                          .markContextRead(
                            channel.id,
                            timestamp,
                            clearForcedMessages: true,
                          );
                      ref
                          .read(channelsProvider.notifier)
                          .clearObservedUnreadCoveredByRead(
                            channel.id,
                            timestamp,
                          );
                    }
                  } else {
                    ref
                        .read(readStateProvider.notifier)
                        .markContextUnread(channel.id, channelId: channel.id);
                  }
                },
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
                  subtitle: muteState!.pendingId != null
                      ? Text(text(PlatformMessageKey.sidebarPreferenceUnknown))
                      : muteState.error != null
                      ? Text(text(PlatformMessageKey.platformLoadFailed))
                      : null,
                  trailing: muteState.busy
                      ? const SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : muted == null || muteState.pendingId != null
                      ? IconButton(
                          tooltip: text(
                            muteState.pendingId != null
                                ? PlatformMessageKey.dmCheckStatus
                                : PlatformMessageKey.platformRefresh,
                          ),
                          icon: const Icon(LucideIcons.refreshCw),
                          onPressed: () => ref
                              .read(conversationMuteProvider.notifier)
                              .recheck(),
                        )
                      : null,
                  onTap:
                      muted == null ||
                          muteState.busy ||
                          muteState.pendingId != null
                      ? null
                      : () async {
                          await ref
                              .read(conversationMuteProvider.notifier)
                              .setMuted(channel.id, !muted);
                          if (context.mounted &&
                              ref
                                      .read(conversationMuteProvider)
                                      .muted(channel.id) ==
                                  !muted &&
                              ref.read(conversationMuteProvider).pendingId ==
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
