part of '../compose_bar.dart';

String _composerDraftIdentity(WidgetRef ref) =>
    '${ref.watch(relayConfigProvider).baseUrl}'
    ':${ref.watch(myPubkeyProvider) ?? 'anon'}';

void _useComposerFocusRestorer({
  required ValueChanged<VoidCallback>? onChanged,
  required ValueNotifier<bool> isExpanded,
  required FocusNode focusNode,
  required VoidCallback expand,
}) {
  useEffect(() {
    if (onChanged == null) return null;

    var isCurrent = true;
    void restoreFocus() {
      if (!isCurrent) return;
      if (isExpanded.value) {
        focusNode.requestFocus();
      } else {
        expand();
      }
    }

    onChanged(restoreFocus);
    return () => isCurrent = false;
  }, [onChanged, focusNode]);
}

void _useComposerChannelNames(
  _MarkdownEditingController controller,
  AsyncValue<List<Channel>> channelsAsync,
) {
  final channelNames = {
    for (final channel in channelsAsync.asData?.value ?? const <Channel>[])
      channel.name.toLowerCase(): channel.id,
  };
  final channelNamesKey = channelNames.entries
      .map((entry) => '${entry.key}\u0000${entry.value}')
      .join('\u0001');
  useEffect(() {
    controller.setChannelNames(channelNames);
    return null;
  }, [controller, channelNamesKey]);
}

class _ComposerKeyboardMetricsObserver with WidgetsBindingObserver {
  final FlutterView view;
  final VoidCallback onKeyboardShown;
  final VoidCallback onKeyboardHidden;
  bool _wasVisible;

  _ComposerKeyboardMetricsObserver({
    required this.view,
    required this.onKeyboardShown,
    required this.onKeyboardHidden,
  }) : _wasVisible = view.viewInsets.bottom > 0;

  @override
  void didChangeMetrics() {
    final isVisible = view.viewInsets.bottom > 0;
    if (!_wasVisible && isVisible) onKeyboardShown();
    if (_wasVisible && !isVisible) onKeyboardHidden();
    _wasVisible = isVisible;
  }
}

void _runComposerAction(VoidCallback action) {
  unawaited(HapticFeedback.selectionClick());
  action();
}

void _showComposerEmojiPicker(
  BuildContext context,
  ValueChanged<String> onSelect,
  VoidCallback onDismiss,
) {
  showEmojiPicker(
    context: context,
    onSelect: (emoji) => _runComposerAction(() => onSelect(emoji)),
    onDismiss: onDismiss,
  );
}

void _dismissComposerKeyboard(FocusNode focusNode) {
  focusNode.unfocus();
  unawaited(SystemChannels.textInput.invokeMethod<void>('TextInput.hide'));
}

void _chooseComposerAttachment(
  BuildContext context,
  ValueNotifier<_AttachmentSurface> attachmentSurface,
  ValueNotifier<String?> uploadError,
  Future<void> Function() choose, {
  String? errorMessage,
}) {
  attachmentSurface.value = _AttachmentSurface.closed;
  unawaited(() async {
    try {
      await choose();
    } catch (error) {
      if (context.mounted) {
        uploadError.value = errorMessage ?? _formatUploadError(error);
      }
    }
  }());
}

Duration _composerMotionDuration(
  bool reducedMotion,
  _AttachmentSurface surface,
) => reducedMotion
    ? Duration.zero
    : Duration(
        milliseconds:
            surface == _AttachmentSurface.camera ||
                surface == _AttachmentSurface.photos
            ? 320
            : 250,
      );

void _expandComposer({
  required BuildContext context,
  required ValueNotifier<bool> isExpanded,
  required ValueNotifier<_AttachmentSurface> attachmentSurface,
  required VoidCallback? onFocusRequested,
  required FocusNode focusNode,
  required FlutterView view,
  required ValueNotifier<bool> androidImeTransitionStarted,
  required ObjectRef<Timer?> androidImeFallbackTimer,
}) {
  if (isExpanded.value) return;
  attachmentSurface.value = _AttachmentSurface.closed;
  onFocusRequested?.call();
  isExpanded.value = true;
  // Attach the editor before requesting focus so native restoration cannot
  // reopen a composer behind a popped route.
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (context.mounted && isExpanded.value) focusNode.requestFocus();
  });
  if (defaultTargetPlatform != TargetPlatform.android) return;
  androidImeFallbackTimer.value?.cancel();
  if (view.viewInsets.bottom > 0) {
    androidImeTransitionStarted.value = true;
    return;
  }
  androidImeTransitionStarted.value = false;
  androidImeFallbackTimer.value = Timer(const Duration(milliseconds: 250), () {
    if (context.mounted && isExpanded.value) {
      androidImeTransitionStarted.value = true;
    }
  });
}

Widget _composerSuggestionPanel({
  required List<Channel> channelSuggestions,
  required List<MentionCandidate> mentionSuggestions,
  required Map<String, UserProfile> userCache,
  required String? currentPubkey,
  required ValueChanged<Channel> onChannelSelect,
  required ValueChanged<MentionCandidate> onMentionSelect,
}) => channelSuggestions.isNotEmpty
    ? KeyedSubtree(
        key: const ValueKey('channel-suggestions'),
        child: _ChannelSuggestions(
          suggestions: channelSuggestions,
          onSelect: onChannelSelect,
        ),
      )
    : mentionSuggestions.isNotEmpty
    ? KeyedSubtree(
        key: const ValueKey('mention-suggestions'),
        child: _MentionSuggestions(
          suggestions: mentionSuggestions,
          userCache: userCache,
          currentPubkey: currentPubkey,
          onSelect: onMentionSelect,
        ),
      )
    : const SizedBox.shrink(key: ValueKey('no-suggestions'));

Widget _composerAttachmentPanel({
  required _AttachmentSurface surface,
  required Widget suggestionPanel,
  required VoidCallback onBack,
  required VoidCallback onCamera,
  required VoidCallback onPhotos,
  required VoidCallback onVideo,
  required VoidCallback onVoiceNote,
  required VoidCallback onFiles,
  required Future<void> Function(XFile image) onCapture,
  required Future<List<XFile>> Function() onPickAllPhotos,
  required Future<void> Function(List<XFile> photos) onChoosePhotos,
  required Future<void> Function(List<XFile> photos) onChooseAllPhotos,
}) => _AttachmentSurfacePanel(
  key: ValueKey(
    surface == _AttachmentSurface.closed
        ? 'composer-suggestions'
        : 'attachment-surface',
  ),
  surface: surface,
  suggestionPanel: suggestionPanel,
  onBack: onBack,
  onCamera: onCamera,
  onPhotos: onPhotos,
  onVideo: onVideo,
  onVoiceNote: onVoiceNote,
  onFiles: onFiles,
  onCapture: onCapture,
  onPickAllPhotos: onPickAllPhotos,
  onChoosePhotos: onChoosePhotos,
  onChooseAllPhotos: onChooseAllPhotos,
);

const _typingThrottleMs = 3000;

/// Buzz 779af8886caae1317b4de962082429867ab61503 `_sendTypingIndicator`, restored.
/// Kailo: the kind:20002 event is this device's own CLIENT-signed event sent
/// straight to the Relay over its WebSocket (DD-75). It is ephemeral and latest
/// wins: a rejection or unknown outcome is not re-signed or resent; the next
/// keystroke replaces it. A thread composer carries the same thread reference
/// as its replies: the thread head as `reply`, and the root only when it differs.
void _sendTypingIndicator(
  WidgetRef ref, {
  required String channelId,
  String? threadHeadId,
  String? rootId,
}) {
  try {
    final session = ref.read(relaySessionProvider.notifier);
    final event =
        SignedEventRelay(
          session: session,
          nsec: ref.read(relayConfigProvider).nsec,
        ).prepare(
          kind: EventKind.typingIndicator,
          content: '',
          tags: [
            ['h', channelId],
            if (threadHeadId != null &&
                rootId != null &&
                rootId != threadHeadId) ...[
              ['e', rootId, '', 'root'],
              ['e', threadHeadId, '', 'reply'],
            ] else if (threadHeadId != null)
              ['e', threadHeadId, '', 'reply'],
          ],
        );
    unawaited(session.publish(event).then<void>((_) {}, onError: (_) {}));
  } catch (_) {
    // Typing is best-effort: without a signing key there is nothing to send.
  }
}

const _pastedImageMimeTypes = <String>[
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

/// Cap on ranked mention suggestions shown — matches desktop's
/// `MENTION_SUGGESTION_LIMIT`.
const _mentionSuggestionLimit = 50;

/// Walk backward from [cursor] looking for [trigger] (e.g. `@` or `#`) at a
/// word boundary. Returns the index of the trigger character, or `null` if none
/// is found.
///
/// When [stopAtSpace] is `true` the walk stops at both spaces and newlines —
/// appropriate for `#channel` names which are kebab-case slugs without spaces.
/// When `false`, only newlines stop the walk, allowing multi-word queries like
/// `@Alice Smith` to match members with multi-word display names.
@visibleForTesting
int? findTrigger(
  String text,
  int cursor,
  String trigger, {
  bool stopAtSpace = true,
}) {
  for (var i = cursor - 1; i >= 0; i--) {
    final ch = text[i];
    if (ch == '\n') break;
    if (stopAtSpace && ch == ' ') break;
    if (ch == trigger) {
      if (i == 0 || text[i - 1] == ' ' || text[i - 1] == '\n') {
        return i;
      }
      break;
    }
  }
  return null;
}

/// Replace the range `[start, cursor)` with [replacement] and move the cursor
/// to the end of the replacement. Used by both mention and channel insertion.
@visibleForTesting
void spliceAndMoveCursor(
  TextEditingController controller,
  FocusNode focusNode, {
  required int start,
  required String replacement,
}) {
  final text = controller.text;
  final cursor =
      (controller.selection.isValid
              ? controller.selection.baseOffset
              : text.length)
          .clamp(start, text.length);

  final before = text.substring(0, start);
  final after = text.substring(cursor);
  controller.value = TextEditingValue(
    text: '$before$replacement$after',
    selection: TextSelection.collapsed(offset: start + replacement.length),
  );
  focusNode.requestFocus();
}

/// Insert [trigger] (e.g. `@` or `#`) at the cursor position, prefixed with
/// a space if needed for word separation. Used by `triggerMention` and
/// `triggerChannel`.
void _insertTriggerAtCursor(
  TextEditingController controller,
  FocusNode focusNode,
  String trigger,
) {
  final text = controller.text;
  final cursor = controller.selection.isValid
      ? controller.selection.baseOffset
      : text.length;
  final needsSpace =
      cursor > 0 && text[cursor - 1] != ' ' && text[cursor - 1] != '\n';
  final insert = needsSpace ? ' $trigger' : trigger;
  final before = text.substring(0, cursor);
  final after = text.substring(cursor);
  controller.value = TextEditingValue(
    text: '$before$insert$after',
    selection: TextSelection.collapsed(offset: cursor + insert.length),
  );
  focusNode.requestFocus();
}

/// User-facing text for a failed send.
String _composeSendErrorMessage(Object error) =>
    error.toString().replaceFirst('Exception: ', '');

/// 一次发送没有被 Relay 接受时，composer 上持续显示的确定状态（apps/06 §4）。
///
/// 发送是 fire-and-forget，瞬时的 SnackBar 在键盘弹起或页面切换时很容易看不到，
/// 于是「被挡下」就成了静默失败。这里的状态留在 composer 上，直到下一次发送、
/// 切换草稿，或（结果不明时）确认 Relay 已存储该事件。
enum _ComposeSendOutcomeKind {
  /// Relay 以 `OK false` 明确拒绝：确定未存储
  rejected,

  /// Relay 限流（`rate-limited:`）：确定未存储，稍后可重试
  rateLimited,

  /// EVENT 没有离开本机：确定未发送
  notSent,

  /// EVENT 已发出而没有 `OK`：不是成功也不是失败
  outcomeUnknown,
}

@immutable
class _ComposeSendOutcome {
  const _ComposeSendOutcome(
    this.kind, {
    this.retryAfterSeconds,
    this.eventId,
    this.restoredText,
  });

  final _ComposeSendOutcomeKind kind;
  final int? retryAfterSeconds;

  /// 结果不明时的事件 id：它出现在 Relay 的消息流里即证明已存储
  final String? eventId;

  /// 结果不明时恢复到 composer 的正文；确认送达时只在正文未被改动时清空
  final String? restoredText;

  _ComposeSendOutcome withRestoredText(String text) => _ComposeSendOutcome(
    kind,
    retryAfterSeconds: retryAfterSeconds,
    eventId: eventId,
    restoredText: text,
  );
}

/// 把发布失败归入确定的界面状态；不是 Relay 发布失败的错误返回 null。
_ComposeSendOutcome? _composeSendOutcomeFor(Object error) => switch (error) {
  RelayPublishRejected(rateLimited: true, :final retryAfterSeconds) =>
    _ComposeSendOutcome(
      _ComposeSendOutcomeKind.rateLimited,
      retryAfterSeconds: retryAfterSeconds,
    ),
  RelayPublishRejected() => const _ComposeSendOutcome(
    _ComposeSendOutcomeKind.rejected,
  ),
  RelayPublishNotSent() => const _ComposeSendOutcome(
    _ComposeSendOutcomeKind.notSent,
  ),
  RelayPublishOutcomeUnknown(:final eventId) => _ComposeSendOutcome(
    _ComposeSendOutcomeKind.outcomeUnknown,
    eventId: eventId,
  ),
  _ => null,
};

/// 状态文案只来自共享平台文案目录；Relay 的原文只作诊断，不上屏。
String _composeSendOutcomeText(_ComposeSendOutcome outcome) =>
    switch (outcome.kind) {
      _ComposeSendOutcomeKind.rejected => platformText(
        PlatformMessageKey.nativeSendRejected,
      ),
      _ComposeSendOutcomeKind.rateLimited => _rateLimitedText(
        outcome.retryAfterSeconds,
      ),
      _ComposeSendOutcomeKind.notSent => platformText(
        PlatformMessageKey.nativeSendNotConnected,
      ),
      _ComposeSendOutcomeKind.outcomeUnknown => platformText(
        PlatformMessageKey.nativeSendOutcomeUnknown,
      ),
    };

/// Reports a send that was cancelled because the active community changed.
///
/// The send path is fire-and-forget, so a `StateError` escaping it would be
/// silent. The composer's own error line cannot carry this message either: the
/// identity change that causes the failure also resets that state on the next
/// frame, so [messenger] must be resolved before the send's first `await`.
void _reportSendCancelledByCommunitySwitch(ScaffoldMessengerState? messenger) {
  messenger?.showSnackBar(
    const SnackBar(content: Text('Message not sent: the community changed')),
  );
}

/// Mentioned identities that aren't in the channel.
///
/// 平台的 Channel roster 只由 Core 变更（`DD-80`）。原版在发送前询问是否邀请这些人
/// （下方 [_resolveNonMemberMentions]）；不邀请时把非成员降为引用标签——名字照常显示，
/// 但不去通知一个不在 Channel 里的人。
Future<List<String>> _nonMemberMentionPubkeys(
  WidgetRef ref, {
  required String channelId,
  required List<MentionCandidate> selectedMentions,
}) async {
  if (selectedMentions.isEmpty) return const [];

  final members = await ref.read(channelMembersProvider(channelId).future);
  final memberPubkeys = {
    for (final member in members) member.pubkey.toLowerCase(),
  };
  return {
    for (final candidate in selectedMentions)
      if (!memberPubkeys.contains(candidate.pubkey.toLowerCase()))
        candidate.pubkey.toLowerCase(),
  }.toList();
}

/// The p-tags and `mention` reference tags an outgoing message should carry.
///
/// Non-members are demoted from a p-tag to a reference tag so their name still
/// renders without notifying them — mirrors desktop's
/// `mergeOutgoingTagsWithReferenceMentions`.
class _OutgoingMentions {
  List<String> pubkeys;
  final List<List<String>> referenceTags = [];

  _OutgoingMentions(List<MentionCandidate> selectedMentions)
    : pubkeys = LinkedHashSet<String>.from(
        selectedMentions.map((candidate) => candidate.pubkey.toLowerCase()),
      ).toList();

  void demote(Iterable<String> demoted) {
    final excluded = {for (final pubkey in demoted) pubkey.toLowerCase()};
    if (excluded.isEmpty) return;
    pubkeys = [
      for (final pubkey in pubkeys)
        if (!excluded.contains(pubkey)) pubkey,
    ];
    referenceTags.addAll([
      for (final pubkey in excluded) ['mention', pubkey],
    ]);
  }
}

String _rateLimitedText(int? retryAfterSeconds) =>
    retryAfterSeconds != null && retryAfterSeconds > 0
    ? platformText(
        PlatformMessageKey.nativeSendRateLimited,
        variables: {'seconds': retryAfterSeconds},
      )
    : platformText(PlatformMessageKey.nativeSendRateLimitedNoHint);

/// Outcome of the original non-member mention prompt. `null` (dismissed) cancels the send
/// and keeps the draft.
enum _NonMemberMentionChoice { invite, sendWithoutInviting }

/// What the send does after the prompt: whether to send at all, and which pubkeys go out
/// only as reference tags.
class _NonMemberMentionResolution {
  const _NonMemberMentionResolution.cancel() : send = false, demote = const [];
  const _NonMemberMentionResolution.send(this.demote) : send = true;

  final bool send;
  final List<String> demote;
}

/// Buzz 779af8886caae1317b4de962082429867ab61503
/// `mobile/lib/features/channels/compose_bar/helpers.dart::_promptNonMemberMention` and
/// desktop `NonMemberMentionDialog`. Kailo (V-SCN-163): "Invite" is offered only when the
/// role projection admits `workspace.member.add` for every mentioned person
/// (`canAddToWorkspace`); the add is the governed action, and the message is sent only after
/// the channel roster shows them. Otherwise the sender may still send without inviting.
Future<_NonMemberMentionChoice?> _promptNonMemberMention(
  BuildContext context, {
  required List<String> names,
  required bool canInvite,
}) {
  final locale = Localizations.localeOf(context).toLanguageTag();
  String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
      platformText(key, locale: locale, variables: variables);
  final notIn = t(
    names.length == 1
        ? PlatformMessageKey.buzzNonMemberMentionNotInChannelOne
        : PlatformMessageKey.buzzNonMemberMentionNotInChannelMany,
    {'names': names.join(', ')},
  );
  return showBuzzDialog<_NonMemberMentionChoice>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(t(PlatformMessageKey.buzzNonMemberMentionTitle)),
      content: Text(
        canInvite
            ? '$notIn ${t(PlatformMessageKey.buzzNonMemberMentionInviteOrSend)}'
            : '$notIn ${t(PlatformMessageKey.buzzNonMemberMentionAddDenied)} '
                  '${t(PlatformMessageKey.buzzNonMemberMentionCanStillSend)}',
      ),
      actions: [
        TextButton(
          key: const ValueKey('non-member-mention-send'),
          onPressed: () => Navigator.of(
            dialogContext,
          ).pop(_NonMemberMentionChoice.sendWithoutInviting),
          child: Text(
            t(
              canInvite
                  ? PlatformMessageKey.buzzNonMemberMentionDoNothing
                  : PlatformMessageKey.buzzNonMemberMentionSendAnyway,
            ),
          ),
        ),
        if (canInvite)
          TextButton(
            key: const ValueKey('non-member-mention-invite'),
            onPressed: () =>
                Navigator.of(dialogContext).pop(_NonMemberMentionChoice.invite),
            child: Text(t(PlatformMessageKey.buzzNonMemberMentionInvite)),
          ),
      ],
    ),
  );
}

/// How long the send waits for invited people to appear in the channel roster.
@visibleForTesting
const nonMemberInviteRosterChecks = 10;

/// Asks about mentioned humans outside the channel and, on "Invite", adds them through the
/// governed `workspace.member.add` before the message goes out. A refused, unconfirmed or
/// still-pending add keeps the draft and says why; nothing is sent on a guess.
Future<_NonMemberMentionResolution> _resolveNonMemberMentions(
  BuildContext context,
  WidgetRef ref, {
  required String channelId,
  required List<String> nonMembers,
  required List<MentionCandidate> selectedMentions,
  required ScaffoldMessengerState? messenger,
  Duration rosterPoll = const Duration(seconds: 1),
}) async {
  if (nonMembers.isEmpty) return const _NonMemberMentionResolution.send([]);
  final pending = {for (final pubkey in nonMembers) pubkey.toLowerCase()};
  final humans = [
    for (final candidate in selectedMentions)
      if (!candidate.isAgent && pending.contains(candidate.pubkey.toLowerCase()))
        candidate,
  ];
  // Agents outside the channel are never invited as members; they only lose the p-tag.
  if (humans.isEmpty) return _NonMemberMentionResolution.send(nonMembers);

  Map<String, RoleMemberView>? roles;
  try {
    roles = await ref.read(channelRoleMembersProvider(channelId).future);
  } on Object {
    roles = null;
  }
  final invitees = <String, RoleMemberView>{};
  for (final candidate in humans) {
    final key = candidate.pubkey.toLowerCase();
    for (final role in roles?.values ?? const <RoleMemberView>[]) {
      if (role.canAddToWorkspace == true &&
          (role.pubkeys ?? const []).any((p) => p.toLowerCase() == key)) {
        invitees[key] = role;
        break;
      }
    }
  }
  final canInvite = invitees.length == humans.length;
  if (!context.mounted) return const _NonMemberMentionResolution.cancel();
  final names = [for (final candidate in humans) candidate.label];
  final choice = await _promptNonMemberMention(
    context,
    names: names,
    canInvite: canInvite,
  );
  if (choice == null) return const _NonMemberMentionResolution.cancel();
  if (choice == _NonMemberMentionChoice.sendWithoutInviting) {
    return _NonMemberMentionResolution.send(nonMembers);
  }

  final locale = context.mounted
      ? Localizations.localeOf(context).toLanguageTag()
      : null;
  void tell(PlatformMessageKey key) => messenger?.showSnackBar(
    SnackBar(
      content: Text(
        platformText(
          key,
          locale: locale,
          variables: {'names': names.join(', ')},
        ),
      ),
    ),
  );

  final actions = ref.read(channelGovernedActionsProvider);
  for (final role in invitees.values) {
    final outcome = await actions.changeMember(
      workspaceId: channelId,
      principalId: role.principalId,
      actionKey: workspaceMemberAddAction,
    );
    switch (outcome) {
      case ChannelActionRecorded():
        continue;
      case ChannelActionRejected() || ChannelActionAborted():
        tell(PlatformMessageKey.buzzNonMemberMentionInviteRejected);
        return const _NonMemberMentionResolution.cancel();
      case ChannelActionWaiting():
        tell(PlatformMessageKey.buzzNonMemberMentionInviteTimeout);
        return const _NonMemberMentionResolution.cancel();
      case ChannelActionUnknown() || null:
        tell(PlatformMessageKey.buzzNonMemberMentionInviteError);
        return const _NonMemberMentionResolution.cancel();
    }
  }

  for (var check = 0; check < nonMemberInviteRosterChecks; check++) {
    ref.invalidate(channelMembersProvider(channelId));
    final members = await ref.read(channelMembersProvider(channelId).future);
    final roster = {for (final member in members) member.pubkey.toLowerCase()};
    if (invitees.keys.every(roster.contains)) {
      // Invited people are members now; only non-invitable agents lose the p-tag.
      return _NonMemberMentionResolution.send([
        for (final pubkey in nonMembers)
          if (!invitees.containsKey(pubkey.toLowerCase())) pubkey,
      ]);
    }
    await Future<void>.delayed(rosterPoll);
  }
  tell(PlatformMessageKey.buzzNonMemberMentionInviteTimeout);
  return const _NonMemberMentionResolution.cancel();
}
