// DD-158 native consumer of the same Core request and shared message catalog.
import 'dart:convert';
import 'dart:io';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import 'feedback_draft.dart';

class FeedbackPage extends ConsumerWidget {
  const FeedbackPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final draft = ref.watch(feedbackDraftProvider);
    return _FeedbackForm(key: ObjectKey(draft), draft: draft);
  }
}

class _FeedbackForm extends HookWidget {
  const _FeedbackForm({super.key, required this.draft});
  final FeedbackDraft draft;

  @override
  Widget build(BuildContext context) {
    useListenable(draft);
    final message = useTextEditingController(text: draft.message);
    final locale = Localizations.localeOf(context).toLanguageTag();
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    final diagnosticFuture = useMemoized(() async {
      final package = await PackageInfo.fromPlatform();
      return const JsonEncoder.withIndent('  ').convert({
        'appVersion': package.version,
        'platform': defaultTargetPlatform.name,
        'userAgent': 'Dart/${Platform.version.split(' ').first}',
        'language': locale,
        'capturedAt': DateTime.now().toUtc().toIso8601String(),
      });
    }, [draft]);
    final diagnostic = useFuture(diagnosticFuture);
    useEffect(() {
      if (draft.diagnostics == null && !draft.locked && diagnostic.hasData) draft.diagnostics = diagnostic.data;
      return null;
    }, [diagnostic.data]);

    Future<void> pickImage() async {
      try {
        final file = await ImagePicker().pickImage(source: ImageSource.gallery, requestFullMetadata: false);
        if (file == null || !context.mounted || draft.locked) return;
        if (await file.length() > 2 * 1024 * 1024) throw const FormatException('image size');
        final bytes = await file.readAsBytes();
        if (context.mounted && !draft.locked) draft.attach(bytes);
      } catch (_) {
        if (context.mounted) { draft.failure = FeedbackFailure.refused; draft.changed(); }
      }
    }

    return FrostedScaffold(
      useUtilitySurfaceTheme: true,
      appBar: FrostedAppBar(centerTitle: true, title: Text(text(PlatformMessageKey.platformFeedbackTitle))),
      body: ListView(
        padding: EdgeInsets.fromLTRB(Grid.gutter, frostedAppBarHeight(context) + Grid.sm, Grid.gutter, Grid.lg),
        children: [
          Text(text(PlatformMessageKey.platformFeedbackPrivacy)),
          const SizedBox(height: Grid.sm),
          Wrap(spacing: Grid.xs, children: [
            for (final choice in [
              (FeedbackCategory.BUG, PlatformMessageKey.platformFeedbackBug),
              (FeedbackCategory.PRAISE, PlatformMessageKey.platformFeedbackPraise),
              (FeedbackCategory.NEEDS_WORK, PlatformMessageKey.platformFeedbackNeedsWork),
            ]) ChoiceChip(label: Text(text(choice.$2)), selected: draft.category == choice.$1,
              onSelected: draft.locked ? null : (selected) { draft.category = selected ? choice.$1 : null; draft.changed(); }),
          ]),
          const SizedBox(height: Grid.sm),
          TextField(key: const ValueKey('feedback-message'), controller: message, enabled: !draft.locked,
            minLines: 5, maxLines: 12, maxLength: 4000,
            decoration: InputDecoration(hintText: text(PlatformMessageKey.platformFeedbackPlaceholder)),
            onChanged: (value) { draft.message = value; draft.changed(); }),
          Text(text(PlatformMessageKey.platformFeedbackLimits), style: context.textTheme.bodySmall),
          if (draft.image != null) ...[
            const SizedBox(height: Grid.sm),
            Image.memory(draft.image!, height: 180, semanticLabel: text(PlatformMessageKey.platformFeedbackImage),
              errorBuilder: (_, _, _) => Text(text(PlatformMessageKey.platformFeedbackFailed))),
            TextButton(onPressed: draft.locked ? null : () { draft.image = null; draft.imageMime = null; draft.changed(); },
              child: Text(text(PlatformMessageKey.platformFeedbackRemoveImage))),
          ] else TextButton(onPressed: draft.locked ? null : pickImage,
              child: Text(text(PlatformMessageKey.platformFeedbackAttachImage))),
          const SizedBox(height: Grid.sm),
          if (draft.diagnostics != null) SelectableText(draft.diagnostics!, key: const ValueKey('feedback-diagnostics')),
          CheckboxListTile(value: draft.includeDiagnostics, contentPadding: EdgeInsets.zero,
            title: Text(text(PlatformMessageKey.platformFeedbackDiagnosticsConsent)),
            onChanged: draft.locked || draft.diagnostics == null ? null : (checked) { draft.includeDiagnostics = checked == true; draft.changed(); }),
          if (draft.failure != null) Text(text(draft.failure == FeedbackFailure.unconfirmed
              ? PlatformMessageKey.platformFeedbackUnknown : PlatformMessageKey.platformFeedbackFailed),
            style: TextStyle(color: context.colors.error)),
          const SizedBox(height: Grid.sm),
          FilledButton(key: const ValueKey('feedback-submit'), onPressed: draft.canSend ? () async {
            if (await draft.submit() && context.mounted) Navigator.of(context).pop();
          } : null, child: Text(text(draft.sending ? PlatformMessageKey.platformFeedbackSending
              : draft.failure == FeedbackFailure.unconfirmed ? PlatformMessageKey.platformFeedbackRetry
              : PlatformMessageKey.platformFeedbackTitle))),
        ],
      ),
    );
  }
}
