// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/manage_channel_sheet.dart. Kailo: name and description are one
// governed `workspace.update` (DD-119), offered only with the BFF's update hint; a channel the
// TTL reaper archived offers only the original reopen (`workspaceUpdate.reopen`). A recorded
// request is not a saved channel: the sheet stays open with the status line until the channel
// reads back. The Canvas section is not offered: Kailo's Canvas is the adopted CONTROL-authored
// body (DD-125(4)) and Mobile has no governed Canvas writer yet.
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import 'channel.dart';
import 'channel_governed_actions.dart';

class ManageChannelSheet extends HookConsumerWidget {
  const ManageChannelSheet({
    super.key,
    required this.channel,
    required this.hints,
  });

  final Channel channel;
  final ChannelManagementHints hints;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);
    final actions = ref.watch(channelGovernedActionsProvider);
    final updateSlot = 'update:${channel.id}';
    final retained = actions.retained(updateSlot)?.workspaceUpdate;
    final nameController = useTextEditingController(
      text: retained?.name ?? channel.name,
    );
    final descriptionController = useTextEditingController(
      text: retained?.description ?? channel.description,
    );
    useListenable(nameController);
    useListenable(descriptionController);
    final isSaving = useState(false);
    final outcome = useState<ChannelActionOutcome?>(null);

    final canEditDetails =
        hints.updateActionKey != null &&
        !hints.canReopen &&
        !channel.isArchived;
    final unknown = actions.retained(updateSlot) != null;
    final canonicalName = nameController.text
        .trim()
        .replaceFirst(RegExp(r'^#+'), '')
        .trim();
    final description = descriptionController.text.trim();
    final nameDirty = canonicalName != channel.name.trim();
    final descriptionDirty = description != channel.description.trim();
    final canSaveDetails =
        canEditDetails &&
        !isSaving.value &&
        (unknown ||
            (canonicalName.isNotEmpty && (nameDirty || descriptionDirty)));

    Future<void> run(Future<ChannelActionOutcome?> Function() submit) async {
      if (isSaving.value) return;
      isSaving.value = true;
      try {
        final result = await submit();
        if (context.mounted && result != null) outcome.value = result;
      } finally {
        if (context.mounted) isSaving.value = false;
      }
    }

    Future<void> saveDetails() => run(
      () => actions.updateChannel(
        workspaceId: channel.id,
        name: nameDirty ? canonicalName : null,
        description: descriptionDirty ? description : null,
      ),
    );

    final status = outcome.value;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        0,
        Grid.gutter,
        MediaQuery.viewInsetsOf(context).bottom + Grid.xs,
      ),
      child: SafeArea(
        top: false,
        child: ListView(
          shrinkWrap: true,
          children: [
            _ManageChannelTextField(
              fieldKey: const ValueKey('manage-channel-name'),
              outlineKey: const ValueKey('manage-channel-name-outline'),
              controller: nameController,
              enabled: canEditDetails && !isSaving.value && !unknown,
              hintText: t(PlatformMessageKey.channelManagementName),
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: Grid.xs),
            _ManageChannelTextField(
              fieldKey: const ValueKey('manage-channel-description'),
              outlineKey: const ValueKey('manage-channel-description-outline'),
              controller: descriptionController,
              enabled: canEditDetails && !isSaving.value && !unknown,
              hintText: t(PlatformMessageKey.channelManagementDescription),
              minLines: 2,
              maxLines: 4,
              textInputAction: TextInputAction.newline,
            ),
            if (canEditDetails && canonicalName.isEmpty) ...[
              const SizedBox(height: Grid.half),
              Text(
                t(PlatformMessageKey.channelManagementNameRequired),
                style: context.textTheme.bodySmall?.copyWith(
                  color: context.colors.error,
                ),
              ),
            ],
            const SizedBox(height: Grid.xs),
            if (canEditDetails)
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  key: const ValueKey('manage-channel-save-details'),
                  onPressed: canSaveDetails ? saveDetails : null,
                  child: Text(
                    t(
                      isSaving.value
                          ? PlatformMessageKey.channelManagementSaving
                          : unknown
                          ? PlatformMessageKey.workspaceCreateRetry
                          : PlatformMessageKey.channelManagementSaveChanges,
                    ),
                  ),
                ),
              ),
            if (hints.canReopen)
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  key: const ValueKey('manage-channel-reopen'),
                  onPressed: isSaving.value
                      ? null
                      : () => run(() => actions.reopenChannel(channel.id)),
                  child: Text(
                    t(
                      isSaving.value
                          ? PlatformMessageKey.channelManagementRestoring
                          : PlatformMessageKey.channelManagementUnarchive,
                    ),
                  ),
                ),
              ),
            if (status != null) ...[
              const SizedBox(height: Grid.xxs),
              Semantics(
                liveRegion: true,
                child: Text(
                  channelActionOutcomeText(status, locale: locale),
                  key: const ValueKey('manage-channel-outcome'),
                  style: context.textTheme.bodySmall?.copyWith(
                    color:
                        status is ChannelActionRecorded ||
                            status is ChannelActionWaiting
                        ? context.colors.onSurfaceVariant
                        : context.colors.error,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ManageChannelTextField extends StatelessWidget {
  const _ManageChannelTextField({
    required this.fieldKey,
    required this.outlineKey,
    required this.controller,
    required this.enabled,
    required this.hintText,
    required this.textInputAction,
    this.minLines = 1,
    this.maxLines = 1,
  });

  final Key fieldKey;
  final Key outlineKey;
  final TextEditingController controller;
  final bool enabled;
  final String hintText;
  final TextInputAction textInputAction;
  final int minLines;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: outlineKey,
      decoration: BoxDecoration(
        border: Border.all(
          color: context.colors.outlineVariant.withValues(alpha: 0.8),
        ),
        borderRadius: BorderRadius.circular(Radii.card),
      ),
      child: Semantics(
        label: hintText,
        textField: true,
        child: TextField(
          key: fieldKey,
          controller: controller,
          enabled: enabled,
          minLines: minLines,
          maxLines: maxLines,
          style: context.textTheme.bodyLarge,
          decoration: InputDecoration(
            hintText: hintText,
            hintStyle: context.textTheme.bodyLarge?.copyWith(
              color: context.colors.onSurfaceVariant,
            ),
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: Grid.xs,
              vertical: Grid.twelve,
            ),
          ),
          textInputAction: textInputAction,
        ),
      ),
    );
  }
}
