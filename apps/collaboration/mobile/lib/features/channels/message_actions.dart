import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:path_provider/path_provider.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:share_plus/share_plus.dart';

import '../../shared/clipboard_utils.dart';
import '../../shared/deeplink/deep_link.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/sheet_divider.dart';
import '../../shared/widgets/modal_presentation.dart';
import 'message_action_backdrop_state.dart';
import '../../shared/read_state/message_read_state.dart';
import '../../shared/read_state/read_state_format.dart';
import '../../shared/read_state/read_state_provider.dart';
import 'thread_detail_page.dart';
import 'thread_follows/thread_follows_provider.dart';
import 'timeline_message.dart';

part 'message_actions/message_action_popover.dart';
part 'message_actions/message_action_popover_widgets.dart';

const _messageActionBackdropBlurSigma = 20.0;
const _messageActionBackdropTintOpacity = 0.10;
final _messageActionBackdropFilter = ImageFilter.blur(
  sigmaX: _messageActionBackdropBlurSigma,
  sigmaY: _messageActionBackdropBlurSigma,
);

/// 移动端在 Channel 里只发布消息（kind 9）：表情回应、编辑、删除与提醒都
/// 不交付（`DD-80` 只放行已交付能力所需的 kind），这里不生成它们的入口。
///
/// Presents the actions for [message] as an anchored popover when both
/// [anchorRect] and [captureAnchorSnapshot] are supplied, otherwise as a sheet.
///
/// Popover capture is asynchronous: [captureAnchorSnapshot] must remain valid
/// until its future completes, and the returned image becomes this function's
/// responsibility to dispose. [onPopoverPreviewVisibilityChanged] reports
/// whether the constrained layout actually renders the lifted preview;
/// [onPopoverDismissed] runs after the route completes while [context] is still
/// mounted. Neither callback runs for sheet fallback or a failed capture.
///
/// [composerFocusNode] remains caller-owned and must outlive the popover. If it
/// has focus when this function is called, the popover unfocuses it and invokes
/// [restoreComposerFocus] only after a dismissal with no selected action. The
/// restorer must remain callable for the same lifetime and no-op if its composer
/// is later disposed or replaced.
void showMessageActions({
  required BuildContext context,
  required WidgetRef ref,
  required TimelineMessage message,
  required String channelId,
  List<TimelineMessage>? allMessages,
  String? currentPubkey,
  bool isMember = false,
  Rect? anchorRect,
  Future<ui.Image> Function()? captureAnchorSnapshot,
  ValueChanged<bool>? onPopoverPreviewVisibilityChanged,
  VoidCallback? onPopoverDismissed,
  FocusNode? composerFocusNode,
  VoidCallback? restoreComposerFocus,
  bool isArchived = false,
  EdgeInsets popoverSpotlightPadding = const EdgeInsets.all(Grid.xxs),
}) {
  // System rows carry no message actions.
  if (message.isSystem) return;

  if (_tryShowMessageActionsPopover(
    context: context,
    ref: ref,
    message: message,
    channelId: channelId,
    allMessages: allMessages,
    currentPubkey: currentPubkey,
    isMember: isMember,
    isArchived: isArchived,
    anchorRect: anchorRect,
    captureAnchorSnapshot: captureAnchorSnapshot,
    onPopoverPreviewVisibilityChanged: onPopoverPreviewVisibilityChanged,
    onPopoverDismissed: onPopoverDismissed,
    composerFocusNode: composerFocusNode,
    restoreComposerFocus: restoreComposerFocus,
  )) {
    return;
  }

  showBuzzModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    showCloseButton: false,
    builder: (sheetContext) => SafeArea(
      child: IconTheme.merge(
        data: const IconThemeData(size: 22),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.7,
          ),
          child: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                0,
                Grid.gutter,
                Grid.xs,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ...[
                    // Fast actions: respond now, hand off context, defer.
                    _FastActionsRow(
                      message: message,
                      channelId: channelId,
                      allMessages: allMessages,
                      currentPubkey: currentPubkey,
                      isMember: isMember,
                      isArchived: isArchived,
                      pageContext: context,
                    ),
                    const SizedBox(height: Grid.xs),
                    // Triage: come back to this message later.
                    _MarkReadUnreadTile(message: message, channelId: channelId),
                    _FollowThreadTile(message: message),
                    const SheetDivider(),
                    // Export: take the content out of the conversation.
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(LucideIcons.copy),
                      title: const Text('Copy text'),
                      onTap: () {
                        Navigator.of(sheetContext).pop();
                        // Copy to clipboard
                        final data = ClipboardData(text: message.content);
                        Clipboard.setData(data);
                      },
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// Image-focused actions shown from the full-screen viewer.
void showImageActions({
  required BuildContext context,
  required WidgetRef ref,
  required TimelineMessage message,
  required String channelId,
  required String imageUrl,
}) {
  showBuzzModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: IconTheme.merge(
        data: const IconThemeData(size: 22),
        child: Padding(
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
                contentPadding: EdgeInsets.zero,
                leading: const Icon(LucideIcons.download),
                title: const Text('Save image'),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  unawaited(_saveImage(context, ref, imageUrl));
                },
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(LucideIcons.share2),
                title: const Text('Share image'),
                onTap: () {
                  final renderBox = context.findRenderObject() as RenderBox?;
                  final shareOrigin = renderBox == null
                      ? null
                      : renderBox.localToGlobal(Offset.zero) & renderBox.size;
                  Navigator.of(sheetContext).pop();
                  unawaited(
                    _shareImage(
                      context,
                      ref,
                      imageUrl,
                      shareOrigin: shareOrigin,
                    ),
                  );
                },
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(LucideIcons.link2),
                title: const Text('Copy image link'),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  copyToClipboard(
                    context,
                    imageUrl,
                    message: 'Image link copied',
                  );
                },
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

@immutable
class _DownloadedImage {
  final Uint8List bytes;
  final String filename;

  const _DownloadedImage({required this.bytes, required this.filename});
}

Future<_DownloadedImage> _downloadImage(WidgetRef ref, String imageUrl) async {
  final response = await ref
      .read(mediaHttpClientProvider)
      .get(
        Uri.parse(imageUrl),
        headers: ref.read(mediaGetAuthServiceProvider).headersFor(imageUrl),
      );
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw HttpException(
      'Image download failed (${response.statusCode})',
      uri: Uri.parse(imageUrl),
    );
  }
  return _DownloadedImage(
    bytes: response.bodyBytes,
    filename: downloadedImageFilename(
      imageUrl,
      response.headers['content-type'],
    ),
  );
}

/// Returns a safe image filename while preserving supported image formats.
@visibleForTesting
String downloadedImageFilename(String imageUrl, String? contentType) {
  final pathSegments = Uri.tryParse(imageUrl)?.pathSegments;
  final rawName = pathSegments == null || pathSegments.isEmpty
      ? ''
      : pathSegments.last;
  final safeName = rawName
      .replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '-')
      .replaceAll(RegExp(r'-+'), '-');
  if (RegExp(
    r'\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$',
    caseSensitive: false,
  ).hasMatch(safeName)) {
    return safeName;
  }
  final extension = switch (contentType?.split(';').first.trim()) {
    'image/avif' => '.avif',
    'image/gif' => '.gif',
    'image/heic' => '.heic',
    'image/heif' => '.heif',
    'image/png' => '.png',
    'image/webp' => '.webp',
    _ => '.jpg',
  };
  return 'buzz-${DateTime.now().millisecondsSinceEpoch}$extension';
}

Future<void> _saveImage(
  BuildContext context,
  WidgetRef ref,
  String imageUrl,
) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  try {
    final needsPhotoLibraryPermission =
        defaultTargetPlatform == TargetPlatform.iOS ||
        await requiresLegacyMediaStoragePermission();
    if (needsPhotoLibraryPermission) {
      final permission = await PhotoManager.requestPermissionExtend(
        requestOption: const PermissionRequestOption(
          iosAccessLevel: IosAccessLevel.addOnly,
          androidPermission: AndroidPermission(
            type: RequestType.image,
            mediaLocation: false,
          ),
        ),
      );
      if (!permission.isAuth) {
        throw const FileSystemException(
          'Photo library permission was not granted.',
        );
      }
    }
    final image = await _downloadImage(ref, imageUrl);
    await PhotoManager.editor.saveImage(image.bytes, filename: image.filename);
    messenger?.showSnackBar(
      const SnackBar(content: Text('Image saved to Photos')),
    );
  } catch (_) {
    messenger?.showSnackBar(
      const SnackBar(content: Text('Could not save image')),
    );
  }
}

Future<void> _shareImage(
  BuildContext context,
  WidgetRef ref,
  String imageUrl, {
  Rect? shareOrigin,
}) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  try {
    final image = await _downloadImage(ref, imageUrl);
    final directory = await getTemporaryDirectory();
    final file = File(
      '${directory.path}${Platform.pathSeparator}${image.filename}',
    );
    await file.writeAsBytes(image.bytes, flush: true);
    await SharePlus.instance.share(
      ShareParams(files: [XFile(file.path)], sharePositionOrigin: shareOrigin),
    );
  } catch (_) {
    messenger?.showSnackBar(
      const SnackBar(content: Text('Could not share image')),
    );
  }
}

/// Canonical `buzz://message` link for a timeline message, including thread
/// context when the message is a reply.
String messageLinkFor({
  required TimelineMessage message,
  required String channelId,
}) {
  return buildMessageLink(
    channelId: channelId,
    messageId: message.id,
    threadRootId: message.rootId,
  );
}

class _MarkReadUnreadTile extends ConsumerWidget {
  final TimelineMessage message;
  final String channelId;

  const _MarkReadUnreadTile({required this.message, required this.channelId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final readState = ref.watch(readStateProvider);
    if (!readState.isReady) return const SizedBox.shrink();

    final unread = isMessageUnread(
      readState,
      channelId: channelId,
      messageId: message.id,
      createdAt: message.createdAt,
      threadRootId: message.rootId,
    );

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(unread ? LucideIcons.mailCheck : LucideIcons.mailOpen),
      title: Text(unread ? 'Mark read' : 'Mark unread'),
      onTap: () {
        Navigator.of(context).pop();
        final notifier = ref.read(readStateProvider.notifier);
        if (unread) {
          // Advances the `msg:` marker and clears this message's own forced
          // flag — a channel-level forced unread (channel tile) is a separate
          // choice and stays untouched.
          notifier.markContextRead(
            msgContextKey(message.id),
            message.createdAt,
          );
        } else {
          // Read markers are monotonic and cannot move backward, so mark
          // unread forces this message unread locally (session-local, does
          // not survive relaunch). The channel surfaces it as unread too.
          notifier.markContextUnread(
            msgContextKey(message.id),
            channelId: channelId,
          );
        }
      },
    );
  }
}

class _FollowThreadTile extends ConsumerWidget {
  final TimelineMessage message;

  const _FollowThreadTile({required this.message});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final follows = ref.watch(threadFollowsProvider);
    // Follow acts on the effective thread root: the root for replies, the
    // message itself for potential thread heads (matches desktop).
    final rootId = message.rootId ?? message.id;
    final following = follows.isFollowing(rootId);

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(following ? LucideIcons.bellOff : LucideIcons.bellRing),
      title: Text(following ? 'Unfollow thread' : 'Follow thread'),
      onTap: () {
        Navigator.of(context).pop();
        final notifier = ref.read(threadFollowsProvider.notifier);
        if (following) {
          notifier.unfollowThread(rootId);
        } else {
          notifier.followThread(rootId);
        }
      },
    );
  }
}

class _FastActionsRow extends ConsumerWidget {
  final TimelineMessage message;
  final String channelId;
  final List<TimelineMessage>? allMessages;
  final String? currentPubkey;
  final bool isMember;
  final bool isArchived;

  /// The long-pressed message's page context — survives the sheet pop, used
  /// for the thread push and the copy-link snackbar.
  final BuildContext pageContext;

  const _FastActionsRow({
    required this.message,
    required this.channelId,
    required this.allMessages,
    required this.currentPubkey,
    required this.isMember,
    required this.isArchived,
    required this.pageContext,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final messages = allMessages;

    final tiles = <Widget>[
      if (messages != null)
        _FastActionTile(
          icon: LucideIcons.messageSquareReply,
          label: 'Reply',
          onTap: () {
            Navigator.of(context).pop();
            Navigator.of(pageContext).push(
              MaterialPageRoute<void>(
                builder: (_) => ThreadDetailPage(
                  threadHead: message,
                  allMessages: messages,
                  channelId: channelId,
                  currentPubkey: currentPubkey,
                  isMember: isMember,
                  isArchived: isArchived,
                ),
              ),
            );
          },
        ),
      _FastActionTile(
        icon: LucideIcons.link2,
        label: 'Copy link',
        onTap: () {
          Navigator.of(context).pop();
          copyToClipboard(
            pageContext,
            messageLinkFor(message: message, channelId: channelId),
            message: 'Message link copied',
          );
        },
      ),
    ];

    return Row(
      children: [
        for (var index = 0; index < tiles.length; index++) ...[
          Expanded(child: tiles[index]),
          if (index < tiles.length - 1) const SizedBox(width: Grid.twelve),
        ],
      ],
    );
  }
}

class _FastActionTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _FastActionTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        unawaited(HapticFeedback.lightImpact());
        onTap();
      },
      behavior: HitTestBehavior.opaque,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The full-width tiles deliberately contrast with the compact emoji
          // reactions immediately above them.
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
}
