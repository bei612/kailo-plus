part of '../channels_page.dart';

// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/channels_page/sheets.dart::_NewDirectMessageSheet
// Original recipient layout/chips/keyboard submission. Kailo's trusted HUMAN
// directory and governed action replace preview users and selected-p direct POST.
class _NewDirectMessageSheet extends HookConsumerWidget {
  const _NewDirectMessageSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = useTextEditingController();
    final focus = useFocusNode();
    final query = useState('');
    final debounced = useState('');
    final selected = useState<List<ConversationParticipant>>([]);
    final submitting = useState(false);
    final error = useState<String?>(null);
    final revision = useState(0);
    final consumer = ref.watch(directMessagesProvider).asData?.value;
    final openedConsumer = useRef<DirectMessages?>(null);
    openedConsumer.value ??= consumer;
    final sameConsumer =
        openedConsumer.value == null ||
        identical(openedConsumer.value, consumer);
    final directory = ref.watch(conversationDirectoryProvider);
    final pending = consumer?.pendingCommand;
    final locked = !sameConsumer || submitting.value || pending != null;
    useEffect(() {
      if (!sameConsumer) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (context.mounted) Navigator.of(context).pop();
        });
      }
      return null;
    }, [sameConsumer]);
    useEffect(() {
      final timer = Timer(const Duration(milliseconds: 250), () {
        debounced.value = query.value.trim().toLowerCase();
      });
      return timer.cancel;
    }, [query.value]);
    final people =
        directory.asData?.value.people ?? const <ConversationParticipant>[];
    final recipients = pending == null
        ? selected.value
        : people
              .where(
                (person) =>
                    person.principalId != consumer?.principalId &&
                    pending.conversationOpen!.participantPrincipalIds.contains(
                      person.principalId,
                    ),
              )
              .toList();
    final chosen = recipients.map((person) => person.principalId).toSet();
    final results = people
        .where(
          (person) =>
              person.principalId != consumer?.principalId &&
              !chosen.contains(person.principalId) &&
              (debounced.value.isEmpty ||
                  person.label.toLowerCase().contains(debounced.value) ||
                  person.pubkeys.any((key) => key.contains(debounced.value))),
        )
        .toList();
    final maximum = directory.asData?.value.maxParticipants;

    Future<void> submit({bool recheck = false}) async {
      if (consumer == null ||
          !sameConsumer ||
          submitting.value ||
          (!recheck && (pending != null || recipients.isEmpty))) {
        return;
      }
      submitting.value = true;
      error.value = null;
      try {
        final channel = recheck
            ? await consumer.recheck()
            : await consumer.openDm(
                principalIds: recipients
                    .map((person) => person.principalId)
                    .toList(),
              );
        if (context.mounted) Navigator.of(context).pop(channel);
      } on DirectMessageEnded catch (ended) {
        if (context.mounted) {
          error.value = ended.task.reason == null
              ? _channelText(context, PlatformMessageKey.dmDenied)
              : platformReasonText(
                  ended.task.reason!,
                  locale: Localizations.localeOf(context).toLanguageTag(),
                );
        }
      } on DirectMessagePending {
        if (context.mounted) {
          error.value = _channelText(
            context,
            PlatformMessageKey.dmPreparationPending,
          );
        }
      } on PlatformApiError catch (failure) {
        if (context.mounted) {
          final body = failure.response.error;
          error.value = body == null
              ? _channelText(context, PlatformMessageKey.dmUnknown)
              : '${platformReasonText(body.reason, locale: Localizations.localeOf(context).toLanguageTag())} (${platformReasonCode(body.reason)})';
        }
      } on Object {
        if (context.mounted) {
          error.value = _channelText(
            context,
            consumer.pendingCommand == null
                ? PlatformMessageKey.dmUnavailable
                : PlatformMessageKey.dmUnknown,
          );
        }
      } finally {
        if (context.mounted) {
          submitting.value = false;
          revision.value++;
        }
      }
    }

    return Padding(
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        0,
        Grid.gutter,
        MediaQuery.viewInsetsOf(context).bottom + Grid.xs,
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              GestureDetector(
                behavior: HitTestBehavior.translucent,
                onTap: locked ? null : focus.requestFocus,
                child: SizedBox(
                  width: double.infinity,
                  child: ConstrainedBox(
                    key: const Key('new-dm-recipient-field'),
                    constraints: const BoxConstraints(minHeight: Grid.xl),
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: context.colors.surface,
                        border: Border.all(
                          color: context.colors.outlineVariant,
                        ),
                        borderRadius: BorderRadius.circular(Radii.lg),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: Grid.twelve,
                          vertical: Grid.xxs,
                        ),
                        child: LayoutBuilder(
                          builder: (context, constraints) => Wrap(
                            key: const Key('new-dm-recipient-wrap'),
                            spacing: 6,
                            runSpacing: 6,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: Grid.half,
                                ),
                                child: Text(
                                  _channelText(
                                    context,
                                    PlatformMessageKey.dmToLabel,
                                  ),
                                  style: context.textTheme.bodyLarge?.copyWith(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              for (final person in recipients)
                                _SelectedDmRecipientChip(
                                  user: person,
                                  enabled: !locked,
                                  onDeleted: () {
                                    selected.value = selected.value
                                        .where(
                                          (row) =>
                                              row.principalId !=
                                              person.principalId,
                                        )
                                        .toList();
                                    focus.requestFocus();
                                  },
                                ),
                              SizedBox(
                                width: recipients.isNotEmpty
                                    ? 96
                                    : (constraints.maxWidth - 32).clamp(
                                        96,
                                        constraints.maxWidth,
                                      ),
                                child: TextField(
                                  key: const Key('new-dm-search'),
                                  controller: controller,
                                  focusNode: focus,
                                  autofocus: true,
                                  autocorrect: false,
                                  enableSuggestions: false,
                                  enabled: !locked,
                                  onChanged: (value) => query.value = value,
                                  onSubmitted: (_) {
                                    if (recipients.isNotEmpty && !locked) {
                                      unawaited(submit());
                                    }
                                  },
                                  textInputAction: TextInputAction.done,
                                  decoration: InputDecoration(
                                    hintText: recipients.isNotEmpty
                                        ? null
                                        : _channelText(
                                            context,
                                            PlatformMessageKey
                                                .nativeDmSearchPerson,
                                          ),
                                    border: InputBorder.none,
                                    enabledBorder: InputBorder.none,
                                    focusedBorder: InputBorder.none,
                                    isDense: true,
                                    contentPadding: const EdgeInsets.symmetric(
                                      vertical: Grid.half,
                                    ),
                                    suffixIcon: submitting.value
                                        ? Padding(
                                            padding: const EdgeInsets.all(
                                              Grid.half,
                                            ),
                                            child: SizedBox.square(
                                              dimension: 16,
                                              child: BuzzLoadingIndicator(
                                                size: 16,
                                                semanticLabel: _channelText(
                                                  context,
                                                  PlatformMessageKey
                                                      .dmPreparing,
                                                ),
                                              ),
                                            ),
                                          )
                                        : null,
                                    suffixIconConstraints: const BoxConstraints(
                                      minHeight: 32,
                                      minWidth: 32,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: Grid.xs),
              Builder(
                key: const Key('new-dm-results'),
                builder: (context) {
                  if (pending != null) {
                    return Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _channelText(
                            context,
                            PlatformMessageKey.dmPreparationPending,
                          ),
                        ),
                        TextButton(
                          key: const Key('new-dm-check-status'),
                          onPressed: submitting.value
                              ? null
                              : () => unawaited(submit(recheck: true)),
                          child: Text(
                            _channelText(
                              context,
                              PlatformMessageKey.dmCheckStatus,
                            ),
                          ),
                        ),
                      ],
                    );
                  }
                  if (directory.isLoading ||
                      query.value.trim().toLowerCase() != debounced.value) {
                    return SizedBox(
                      height: 280,
                      child: Center(
                        child: BuzzLoadingIndicator(
                          size: 44,
                          semanticLabel: _channelText(
                            context,
                            PlatformMessageKey.dmLoadingPeople,
                          ),
                        ),
                      ),
                    );
                  }
                  if (directory.hasError) {
                    return SizedBox(
                      height: 280,
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              _channelText(
                                context,
                                PlatformMessageKey.dmDirectoryUnavailable,
                              ),
                            ),
                            const SizedBox(height: Grid.half),
                            TextButton(
                              onPressed: () =>
                                  ref.invalidate(conversationDirectoryProvider),
                              child: Text(
                                _channelText(
                                  context,
                                  PlatformMessageKey.platformRetry,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }
                  if (maximum != null && recipients.length >= maximum - 1) {
                    return SizedBox(
                      height: 96,
                      child: Center(
                        child: Text(
                          _channelText(
                            context,
                            PlatformMessageKey.dmLimit,
                            variables: {'count': maximum},
                          ),
                        ),
                      ),
                    );
                  }
                  if (results.isEmpty) {
                    return SizedBox(
                      height: 280,
                      child: Center(
                        child: Text(
                          _channelText(
                            context,
                            debounced.value.isEmpty
                                ? PlatformMessageKey.dmEmpty
                                : PlatformMessageKey.dmNoMatch,
                          ),
                        ),
                      ),
                    );
                  }
                  return ListView.separated(
                    physics: const NeverScrollableScrollPhysics(),
                    shrinkWrap: true,
                    itemCount: results.length,
                    separatorBuilder: (_, _) =>
                        const Divider(height: 1, indent: 56),
                    itemBuilder: (context, index) {
                      final person = results[index];
                      return ListTile(
                        key: Key('new-dm-person-${person.principalId}'),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: Grid.half,
                        ),
                        leading: AvatarImage(
                          imageUrl: null,
                          radius: 20,
                          backgroundColor: context.colors.primaryContainer,
                          fallback: Text(
                            person.initial,
                            style: context.textTheme.labelLarge?.copyWith(
                              color: context.colors.onPrimaryContainer,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        title: Text(
                          person.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          person.secondaryLabel,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: Icon(
                          LucideIcons.plus,
                          size: 18,
                          color: context.colors.onSurfaceVariant,
                        ),
                        onTap: locked
                            ? null
                            : () {
                                selected.value = [...selected.value, person];
                                controller.clear();
                                query.value = '';
                                debounced.value = '';
                                error.value = null;
                                focus.requestFocus();
                              },
                      );
                    },
                  );
                },
              ),
              if (error.value case final message?) ...[
                const SizedBox(height: Grid.xxs),
                Text(
                  message,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: context.colors.error,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

extension _DmPersonLabel on ConversationParticipant {
  String get label => conversationParticipantLabel(this);
  String get secondaryLabel =>
      '${pubkeys.first.substring(0, 8)}…${pubkeys.first.substring(56)}';
  String get initial => label.characters.first.toUpperCase();
}

class _SelectedDmRecipientChip extends StatelessWidget {
  const _SelectedDmRecipientChip({
    required this.user,
    required this.enabled,
    required this.onDeleted,
  });
  final ConversationParticipant user;
  final bool enabled;
  final VoidCallback onDeleted;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    key: Key('new-dm-selected-${user.principalId}'),
    constraints: const BoxConstraints(maxWidth: 224),
    child: SizedBox(
      height: 40,
      child: Material(
        color: context.colors.surfaceContainerHighest,
        shape: const StadiumBorder(),
        clipBehavior: Clip.antiAlias,
        child: Semantics(
          button: true,
          enabled: enabled,
          excludeSemantics: true,
          label: _channelText(
            context,
            PlatformMessageKey.dmRemovePerson,
            variables: {'name': user.label},
          ),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: enabled ? onDeleted : null,
            child: Padding(
              padding: const EdgeInsets.only(
                left: Grid.half,
                right: Grid.twelve,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AvatarImage(
                    imageUrl: null,
                    radius: 16,
                    backgroundColor: context.colors.primaryContainer,
                    fallback: Text(
                      user.initial,
                      style: context.textTheme.labelMedium?.copyWith(
                        color: context.colors.onPrimaryContainer,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: Grid.xxs),
                  Flexible(
                    child: Text(
                      user.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.bodyLarge?.copyWith(
                        color: context.colors.onSurfaceVariant,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
