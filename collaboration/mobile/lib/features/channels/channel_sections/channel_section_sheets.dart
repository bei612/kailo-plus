// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/channel_actions_sheet.dart::{_showMoveSectionSheet,
// _showSectionNameDialog} and channels_page/body.dart::_SectionNameDialog: the original
// "Move to section…" picker and the section name dialog, shared by the actions sheet, the
// channel details page and the channel list. Kailo (DD-150(3)): each choice is one Core
// preference write (channel_sections_provider.dart); nothing is moved before Core confirms,
// and a refused or unconfirmed write says so instead of pretending.
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../shared/theme/theme.dart';
import '../../../shared/widgets/modal_presentation.dart';
import '../channel.dart';
import '../direct_messages.dart';

String _text(BuildContext context, PlatformMessageKey key) => platformText(
  key,
  locale: Localizations.localeOf(context).toLanguageTag(),
);

void _reportSectionFailure(BuildContext context, ProviderContainer container) {
  if (!context.mounted) return;
  final state = container.read(channelSectionsProvider);
  ScaffoldMessenger.maybeOf(context)?.showSnackBar(
    SnackBar(
      content: Text(
        _text(
          context,
          state.pending
              ? PlatformMessageKey.sidebarPreferenceUnknown
              : PlatformMessageKey.sidebarSectionUpdateFailed,
        ),
      ),
    ),
  );
}

/// Runs one section write and reports a failure or an unconfirmed outcome.
///
/// [context] must outlive the write (a page or root navigator context); the
/// provider container is taken from it, never from a sheet that closes.
Future<bool> runSectionWrite(
  BuildContext context,
  Future<bool> Function(ChannelSectionsNotifier notifier) write,
) async {
  final container = ProviderScope.containerOf(context, listen: false);
  final ok = await write(container.read(channelSectionsProvider.notifier));
  if (!ok && context.mounted) _reportSectionFailure(context, container);
  return ok;
}

/// Original `_showSectionNameDialog` (also its Rename variant).
Future<String?> showSectionNameDialog(
  BuildContext context, {
  String initialValue = '',
  bool rename = false,
}) async {
  final controller = TextEditingController(text: initialValue);
  final result = await showBuzzDialog<String>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(
        _text(
          dialogContext,
          rename
              ? PlatformMessageKey.sidebarSectionRename
              : PlatformMessageKey.sidebarSectionCreateTitle,
        ),
      ),
      content: TextField(
        key: const ValueKey('channel-section-name'),
        controller: controller,
        autofocus: true,
        decoration: InputDecoration(
          hintText: _text(
            dialogContext,
            PlatformMessageKey.sidebarSectionNamePlaceholder,
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: Text(_text(dialogContext, PlatformMessageKey.platformCancel)),
        ),
        FilledButton(
          key: const ValueKey('channel-section-name-confirm'),
          onPressed: () =>
              Navigator.of(dialogContext).pop(controller.text.trim()),
          child: Text(
            _text(
              dialogContext,
              rename
                  ? PlatformMessageKey.sidebarSectionSave
                  : PlatformMessageKey.sidebarSectionCreate,
            ),
          ),
        ),
      ],
    ),
  );
  controller.dispose();
  return result;
}

/// Original `_showMoveSectionSheet`: pick a section, create one, or remove.
/// [context] must outlive the sheet (a page or root navigator context).
Future<void> showMoveToSectionSheet(
  BuildContext context, {
  required Channel channel,
}) async {
  final container = ProviderScope.containerOf(context, listen: false);
  final state = container.read(channelSectionsProvider);
  final sectionId = state.sectionOf(channel.id);
  await showBuzzModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
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
              for (final section in state.sections)
                ListTile(
                  key: ValueKey('move-section-${section.id}'),
                  contentPadding: EdgeInsets.zero,
                  leading: section.icon == null
                      ? const Icon(LucideIcons.folder)
                      : Text(section.icon!, style: const TextStyle(fontSize: 20)),
                  title: Text(section.name),
                  trailing: sectionId == section.id
                      ? Icon(
                          LucideIcons.check,
                          color: sheetContext.colors.primary,
                        )
                      : null,
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    runSectionWrite(
                      context,
                      (notifier) =>
                          notifier.assignChannel(channel.id, section.id),
                    );
                  },
                ),
              ListTile(
                key: const ValueKey('move-section-new'),
                contentPadding: EdgeInsets.zero,
                leading: const Icon(LucideIcons.folderPlus),
                title: Text(
                  _text(sheetContext, PlatformMessageKey.sidebarSectionNewEllipsis),
                ),
                onTap: () async {
                  Navigator.of(sheetContext).pop();
                  final name = await showSectionNameDialog(context);
                  if (name == null || name.isEmpty || !context.mounted) return;
                  final notifier = container.read(
                    channelSectionsProvider.notifier,
                  );
                  final created = await notifier.createSection(name);
                  if (created == null) {
                    if (context.mounted) {
                      _reportSectionFailure(context, container);
                    }
                    return;
                  }
                  if (!context.mounted) return;
                  await runSectionWrite(
                    context,
                    (notifier) => notifier.assignChannel(channel.id, created),
                  );
                },
              ),
              if (sectionId != null)
                ListTile(
                  key: const ValueKey('move-section-remove'),
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(LucideIcons.folderMinus),
                  title: Text(
                    _text(sheetContext, PlatformMessageKey.sidebarSectionRemove),
                  ),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    runSectionWrite(
                      context,
                      (notifier) => notifier.assignChannel(channel.id, null),
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
