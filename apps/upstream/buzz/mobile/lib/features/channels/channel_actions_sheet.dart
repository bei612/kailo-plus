import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/clipboard_utils.dart';
import '../../shared/read_state/read_state_provider.dart';
import '../../shared/read_state/read_state_time.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../kailo/kailo_members_page.dart';
import 'channel.dart';
import 'channels_provider.dart';

/// Opens the mobile channel actions sheet.
///
/// Kailo Mobile 只提供读取面的动作：已读/未读、成员名单、复制。建 Channel、
/// 加人、改名、静音、收藏、离开、归档与删除都不在移动端交付，入口一律不生成。
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
class ChannelActionsSheet extends ConsumerWidget {
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
                      builder: (_) => KailoMembersPage(
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
