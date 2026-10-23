// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/manage_channel_sheet.dart (Canvas section) and
// channel_management_provider.dart::{channelCanvasProvider, ChannelActions.setCanvas}.
// Kailo (DD-125(4), DD-150(4)): the Canvas is the adopted CONTROL-authored kind 40100 the BFF
// reads (`GET /api/v1/workspaces/{id}/canvas`, the same view Web and Desktop use); the only
// writer is the governed `workspace.canvas.set` (Workspace manage, explicit confirmation), whose
// entry appears only with the BFF's `setActionKey` hint. Saving freezes one command with its
// idempotency key; an unknown outcome keeps it and only that command can be resent (DD-81).
// A recorded request is not a saved Canvas: the section rereads and shows what Core adopted.
import 'dart:async';
import 'dart:convert';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:gpt_markdown/gpt_markdown.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/platform/platform_api.dart';
import '../../shared/platform/platform_config.dart';
import '../../shared/theme/theme.dart';
import 'channel_governed_actions.dart';

const channelCanvasSetActionKey = 'workspace.canvas.set';

/// Original Canvas bound: Markdown up to 64 KiB (SF-BUZ-54).
const maxChannelCanvasBytes = 64 * 1024;

/// The admitted Canvas view of one Workspace channel; a foreign or malformed
/// answer fails closed.
final channelCanvasProvider = FutureProvider.autoDispose
    .family<WebChannelCanvasView, String>((ref, workspaceId) async {
      final config = ref.watch(platformConfigProvider);
      if (config == null) throw const PlatformNotSignedIn();
      final response = await ref
          .read(nativeSessionProvider)
          .send(
            config,
            PlatformMethod.get,
            '/api/v1/workspaces/${Uri.encodeComponent(workspaceId)}/canvas',
          );
      if (response.status != 200) throw PlatformApiError(response);
      final view = WebChannelCanvasView.fromJson(
        response.body! as Map<String, dynamic>,
      );
      if (view.workspaceId != workspaceId ||
          (view.setActionKey != null &&
              view.setActionKey != channelCanvasSetActionKey)) {
        throw const FormatException('Invalid channel canvas view');
      }
      return view;
    }, retry: (_, _) => null);

/// The original manage-sheet Canvas section: read for everyone the BFF admits,
/// edit only with the governed hint.
class ChannelCanvasSection extends HookConsumerWidget {
  const ChannelCanvasSection({
    super.key,
    required this.workspaceId,
    required this.isArchived,
  });

  final String workspaceId;
  final bool isArchived;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);
    final canvasAsync = ref.watch(channelCanvasProvider(workspaceId));
    final actions = ref.watch(channelGovernedActionsProvider);
    final slot = 'canvas:$workspaceId';
    final retained = actions.retained(slot)?.workspaceCanvas;
    final editing = useState(retained != null);
    final saving = useState(false);
    final outcome = useState<ChannelActionOutcome?>(null);
    final controller = useTextEditingController(text: retained?.content ?? '');
    useListenable(controller);
    final unknown = actions.retained(slot) != null;
    final tooLarge =
        utf8.encode(controller.text).length > maxChannelCanvasBytes;

    Future<void> save() async {
      if (saving.value || (tooLarge && !unknown)) return;
      saving.value = true;
      final draft = controller.text;
      final ChannelActionOutcome? result;
      try {
        result = await actions.submit(
          slot,
          (key) => ActionCommand(
            actionKey: channelCanvasSetActionKey,
            idempotencyKey: key,
            workspaceId: workspaceId,
            explicitConfirmation: true,
            workspaceCanvas: WorkspaceCanvasSetInput(content: draft),
          ),
        );
      } finally {
        if (context.mounted) saving.value = false;
      }
      if (result == null || !context.mounted) return;
      outcome.value = result;
      if (result is ChannelActionRecorded || result is ChannelActionWaiting) {
        editing.value = false;
        ref.invalidate(channelCanvasProvider(workspaceId));
      }
    }

    final status = outcome.value;
    final message = switch (status) {
      null => null,
      ChannelActionUnknown() => t(PlatformMessageKey.channelCanvasSaveUnknown),
      _ => channelActionOutcomeText(status, locale: locale),
    };

    return Column(
      key: const ValueKey('channel-canvas-section'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          t(PlatformMessageKey.channelCanvasTitle),
          style: context.textTheme.titleSmall?.copyWith(
            color: context.colors.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: Grid.xxs),
        canvasAsync.when(
          loading: () => Text(
            t(PlatformMessageKey.channelCanvasLoading),
            style: context.textTheme.bodyMedium,
          ),
          error: (_, _) => Text(
            t(PlatformMessageKey.channelCanvasLoadFailed),
            key: const ValueKey('channel-canvas-load-failed'),
            style: context.textTheme.bodyMedium?.copyWith(
              color: context.colors.error,
            ),
          ),
          data: (view) {
            final canEdit = view.setActionKey != null && !isArchived;
            if (editing.value && (canEdit || unknown)) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    key: const ValueKey('channel-canvas-editor'),
                    controller: controller,
                    enabled: !saving.value && !unknown,
                    minLines: 6,
                    maxLines: 12,
                    decoration: InputDecoration(
                      hintText: t(PlatformMessageKey.channelCanvasPlaceholder),
                    ),
                  ),
                  if (tooLarge && !unknown)
                    Padding(
                      padding: const EdgeInsets.only(top: Grid.half),
                      child: Text(
                        t(PlatformMessageKey.channelCanvasTooLarge),
                        style: context.textTheme.bodySmall?.copyWith(
                          color: context.colors.error,
                        ),
                      ),
                    ),
                  const SizedBox(height: Grid.xxs),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(
                        key: const ValueKey('channel-canvas-cancel'),
                        onPressed: saving.value || unknown
                            ? null
                            : () {
                                outcome.value = null;
                                editing.value = false;
                              },
                        child: Text(t(PlatformMessageKey.channelCanvasCancel)),
                      ),
                      const SizedBox(width: Grid.half),
                      FilledButton(
                        key: const ValueKey('channel-canvas-save'),
                        onPressed: saving.value || (tooLarge && !unknown)
                            ? null
                            : () => unawaited(save()),
                        child: Text(
                          t(
                            saving.value
                                ? PlatformMessageKey.channelCanvasSaving
                                : unknown
                                ? PlatformMessageKey.workspaceLifecycleRetry
                                : PlatformMessageKey.channelCanvasSave,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (message != null) _CanvasStatus(message, status!),
                ],
              );
            }
            final content = view.content ?? '';
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (content.trim().isEmpty)
                  Text(
                    t(PlatformMessageKey.channelCanvasEmpty),
                    key: const ValueKey('channel-canvas-empty'),
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: context.colors.onSurfaceVariant,
                    ),
                  )
                else
                  // The Canvas is Markdown (SF-BUZ-54); rendered with the renderer
                  // the original Mobile uses for messages. Links stay text and
                  // images show their address: nothing is fetched or opened from
                  // the Canvas body.
                  SelectionArea(
                    child: GptMarkdown(
                      content,
                      key: const ValueKey('channel-canvas-content'),
                      style: context.textTheme.bodyMedium,
                      followLinkColor: false,
                      autolink: false,
                      imageBuilder: (context, imageUrl, _, _) => Text(
                        imageUrl,
                        style: context.textTheme.bodySmall?.copyWith(
                          color: context.colors.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
                if (canEdit)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      key: const ValueKey('channel-canvas-edit'),
                      onPressed: () {
                        outcome.value = null;
                        controller.text = content;
                        editing.value = true;
                      },
                      child: Text(
                        t(
                          content.trim().isEmpty
                              ? PlatformMessageKey.channelCanvasCreate
                              : PlatformMessageKey.channelCanvasEdit,
                        ),
                      ),
                    ),
                  ),
                if (message != null) _CanvasStatus(message, status!),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _CanvasStatus extends StatelessWidget {
  const _CanvasStatus(this.message, this.status);

  final String message;
  final ChannelActionOutcome status;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Padding(
      padding: const EdgeInsets.only(top: Grid.half),
      child: Text(
        message,
        key: const ValueKey('channel-canvas-outcome'),
        style: context.textTheme.bodySmall?.copyWith(
          color:
              status is ChannelActionRecorded || status is ChannelActionWaiting
              ? context.colors.onSurfaceVariant
              : context.colors.error,
        ),
      ),
    ),
  );
}
