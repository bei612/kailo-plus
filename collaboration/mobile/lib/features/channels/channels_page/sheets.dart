part of '../channels_page.dart';

const int _defaultCreateChannelTtlSeconds = 7 * 24 * 60 * 60;

class _CreateChannelMenuOption<T> {
  final Key? key;
  final String label;
  final T value;

  const _CreateChannelMenuOption({
    this.key,
    required this.label,
    required this.value,
  });
}

List<_CreateChannelMenuOption<int>> _createChannelTtlOptions(
  BuildContext context,
) => [
  _CreateChannelMenuOption(
    label: _channelText(context, PlatformMessageKey.channelTtlMinutes30),
    value: 30 * 60,
  ),
  _CreateChannelMenuOption(
    label: _channelText(context, PlatformMessageKey.channelTtlHour1),
    value: 60 * 60,
  ),
  _CreateChannelMenuOption(
    label: _channelText(context, PlatformMessageKey.channelTtlHours6),
    value: 6 * 60 * 60,
  ),
  _CreateChannelMenuOption(
    label: _channelText(context, PlatformMessageKey.channelTtlHours12),
    value: 12 * 60 * 60,
  ),
  _CreateChannelMenuOption(
    label: _channelText(context, PlatformMessageKey.channelTtlDay1),
    value: 24 * 60 * 60,
  ),
  _CreateChannelMenuOption(
    label: _channelText(context, PlatformMessageKey.channelTtlDays3),
    value: 3 * 24 * 60 * 60,
  ),
  _CreateChannelMenuOption(
    label: _channelText(context, PlatformMessageKey.channelTtlDays7),
    value: _defaultCreateChannelTtlSeconds,
  ),
  _CreateChannelMenuOption(
    label: _channelText(context, PlatformMessageKey.channelTtlDays14),
    value: 14 * 24 * 60 * 60,
  ),
  _CreateChannelMenuOption(
    label: _channelText(context, PlatformMessageKey.channelTtlDays30),
    value: 30 * 24 * 60 * 60,
  ),
];

class _CreateChannelSheet extends HookConsumerWidget {
  final String channelType;

  const _CreateChannelSheet({required this.channelType});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final actionsAsync = ref.watch(channelActionsProvider);
    final actions = actionsAsync.asData?.value;
    final createHint = ref
        .watch(channelCreateRoleProvider)
        .asData
        ?.value
        .createActionKey;
    final original = actions?.pendingCommand;
    final nameController = useTextEditingController();
    final descriptionController = useTextEditingController();
    final visibility = useState('open');
    final temporary = useState(false);
    final ttlSeconds = useState(_defaultCreateChannelTtlSeconds);
    final isSubmitting = useState(false);
    final errorMessage = useState<String?>(null);
    useListenable(nameController);

    final kindLabel = _channelText(
      context,
      PlatformMessageKey.channelBrowserChannel,
    );
    final ttlOptions = _createChannelTtlOptions(context);
    final locked =
        isSubmitting.value ||
        original != null ||
        actions == null ||
        createHint != RoleWorkspacePageCreateActionKey.WORKSPACE_CREATE;
    final canSubmit = nameController.text.trim().isNotEmpty && !locked;
    final restoredMessage = original == null
        ? null
        : _channelCreationMessage(
            context,
            ChannelCreationPending(actions?.submission),
          );
    useEffect(() {
      if (original != null) {
        nameController.text = original.name ?? '';
        descriptionController.text =
            original.workspaceChannel?.description ?? '';
        visibility.value =
            workspaceVisibilityValues.reverse[original.workspaceVisibility] ??
            'private';
        temporary.value = original.workspaceChannel?.ttlSeconds != null;
        ttlSeconds.value =
            original.workspaceChannel?.ttlSeconds ??
            _defaultCreateChannelTtlSeconds;
        errorMessage.value = restoredMessage;
      }
      return null;
    }, [actions, restoredMessage]);

    Future<void> submit({bool reconcile = false}) async {
      if (actions == null || isSubmitting.value || (!reconcile && !canSubmit))
        return;
      isSubmitting.value = true;
      errorMessage.value = null;
      try {
        final created = reconcile
            ? await actions.recheckCreation()
            : await actions.createChannel(
                name: nameController.text.trim(),
                channelType: channelType,
                visibility: visibility.value,
                description: descriptionController.text.trim(),
                ttlSeconds: temporary.value ? ttlSeconds.value : null,
              );
        if (context.mounted) Navigator.of(context).pop(created);
      } catch (error) {
        if (context.mounted) {
          errorMessage.value =
              actions.pendingCommand != null && error is! ChannelCreationPending
              ? _channelText(
                  context,
                  PlatformMessageKey.workspaceCreateUnknown,
                  variables: {
                    'operation':
                        actions.submission?.operationId ??
                        _channelText(
                          context,
                          PlatformMessageKey.tasksStatusUnknown,
                        ),
                  },
                )
              : _channelCreationMessage(context, error);
        }
      } finally {
        if (context.mounted) isSubmitting.value = false;
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
              _CreateChannelFieldLabel(
                label: _channelText(
                  context,
                  PlatformMessageKey.channelCreateName,
                ),
              ),
              const SizedBox(height: Grid.xxs),
              _CreateChannelFieldShell(
                child: TextField(
                  key: const Key('create-channel-name'),
                  controller: nameController,
                  enabled: !locked,
                  autofocus: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  textCapitalization: TextCapitalization.none,
                  decoration: InputDecoration(
                    hintText: channelType == 'forum'
                        ? _channelText(
                            context,
                            PlatformMessageKey
                                .channelCreateForumNamePlaceholder,
                          )
                        : _channelText(
                            context,
                            PlatformMessageKey.channelCreateNamePlaceholder,
                          ),
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: Grid.twelve,
                      vertical: Grid.xs,
                    ),
                  ),
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) {
                    if (canSubmit) {
                      unawaited(submit());
                    }
                  },
                ),
              ),
              const SizedBox(height: Grid.xs),
              _CreateChannelFieldLabel(
                label: _channelText(
                  context,
                  PlatformMessageKey.channelCreateAbout,
                ),
                optional: true,
              ),
              const SizedBox(height: Grid.xxs),
              _CreateChannelFieldShell(
                child: TextField(
                  key: const Key('create-channel-description'),
                  controller: descriptionController,
                  enabled: !locked,
                  decoration: InputDecoration(
                    hintText: _channelText(
                      context,
                      PlatformMessageKey.channelCreateAboutPlaceholder,
                      variables: {'entity': kindLabel},
                    ),
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: Grid.twelve,
                      vertical: Grid.xs,
                    ),
                  ),
                  minLines: 2,
                  maxLines: 3,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) {
                    if (canSubmit) {
                      unawaited(submit());
                    }
                  },
                ),
              ),
              const SizedBox(height: Grid.sm),
              _CreateChannelRadioGroup<bool>(
                enabled: !locked,
                label: _channelText(
                  context,
                  PlatformMessageKey.nativeChannelCreateType,
                ),
                onSelected: (value) => temporary.value = value,
                options: [
                  _CreateChannelMenuOption(
                    key: Key('create-channel-type-ongoing'),
                    label: _channelText(
                      context,
                      PlatformMessageKey.channelTtlOngoing,
                    ),
                    value: false,
                  ),
                  _CreateChannelMenuOption(
                    key: Key('create-channel-type-temporary'),
                    label: _channelText(
                      context,
                      PlatformMessageKey.channelTtlTemporary,
                    ),
                    value: true,
                  ),
                ],
                value: temporary.value,
              ),
              if (temporary.value) ...[
                const SizedBox(height: Grid.xs),
                _CreateChannelSettingMenu<int>(
                  controlKey: const Key('create-channel-ttl'),
                  enabled: !locked,
                  label: _channelText(
                    context,
                    PlatformMessageKey.channelTtlExpires,
                  ),
                  onSelected: (value) => ttlSeconds.value = value,
                  options: ttlOptions,
                  value: ttlSeconds.value,
                  valueLabel: ttlOptions
                      .firstWhere((option) => option.value == ttlSeconds.value)
                      .label,
                ),
              ],
              const SizedBox(height: Grid.sm),
              _CreateChannelRadioGroup<String>(
                enabled: !locked,
                label: _channelText(
                  context,
                  PlatformMessageKey.channelVisibilityLabel,
                ),
                onSelected: (value) => visibility.value = value,
                options: [
                  _CreateChannelMenuOption(
                    key: Key('create-channel-visibility-public'),
                    label: _channelText(
                      context,
                      PlatformMessageKey.channelVisibilityOpen,
                    ),
                    value: 'open',
                  ),
                  _CreateChannelMenuOption(
                    key: Key('create-channel-visibility-private'),
                    label: _channelText(
                      context,
                      PlatformMessageKey.channelVisibilityPrivate,
                    ),
                    value: 'private',
                  ),
                ],
                value: visibility.value,
              ),
              if (actionsAsync.hasError) ...[
                const SizedBox(height: Grid.xs),
                Text(
                  _channelCreationMessage(context, actionsAsync.error!),
                  key: const Key('create-channel-load-error'),
                ),
                TextButton(
                  onPressed: () {
                    ref.invalidate(channelActionsProvider);
                    ref.invalidate(channelCreateRoleProvider);
                  },
                  child: Text(
                    _channelText(context, PlatformMessageKey.platformRetry),
                  ),
                ),
              ],
              if (actions?.pendingCommand != null)
                TextButton(
                  key: const Key('create-channel-recheck'),
                  onPressed: isSubmitting.value
                      ? null
                      : () => unawaited(submit(reconcile: true)),
                  child: Text(
                    _channelText(
                      context,
                      PlatformMessageKey.workspaceCreateRetry,
                    ),
                  ),
                ),
              if (errorMessage.value case final error?) ...[
                const SizedBox(height: Grid.xs),
                Text(
                  error,
                  key: const Key('create-channel-outcome'),
                  style: context.textTheme.bodySmall?.copyWith(
                    color: actions?.pendingCommand != null
                        ? context.colors.onSurfaceVariant
                        : context.colors.error,
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

class _CreateChannelFieldLabel extends StatelessWidget {
  final String label;
  final bool optional;

  const _CreateChannelFieldLabel({required this.label, this.optional = false});

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(text: label),
          if (optional)
            TextSpan(
              text:
                  '  ${_channelText(context, PlatformMessageKey.channelCreateOptional)}',
              style: context.textTheme.labelSmall?.copyWith(
                color: context.colors.onSurfaceVariant.withValues(alpha: 0.6),
                fontWeight: FontWeight.w400,
              ),
            ),
        ],
      ),
      style: context.textTheme.labelLarge?.copyWith(
        color: context.colors.onSurface,
        fontWeight: FontWeight.w600,
      ),
    );
  }
}

class _CreateChannelFieldShell extends StatelessWidget {
  final Widget child;

  const _CreateChannelFieldShell({required this.child});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: context.colors.primaryContainer.withValues(alpha: 0.55),
        border: Border.all(color: context.colors.outlineVariant),
        borderRadius: BorderRadius.circular(Radii.lg),
      ),
      child: child,
    );
  }
}

class _CreateChannelRadioGroup<T> extends StatelessWidget {
  final bool enabled;
  final String label;
  final ValueChanged<T> onSelected;
  final List<_CreateChannelMenuOption<T>> options;
  final T value;

  const _CreateChannelRadioGroup({
    required this.enabled,
    required this.label,
    required this.onSelected,
    required this.options,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _CreateChannelFieldLabel(label: label),
        const SizedBox(height: Grid.xxs),
        DecoratedBox(
          decoration: BoxDecoration(
            color: context.colors.surface,
            border: Border.all(color: context.colors.outlineVariant),
            borderRadius: BorderRadius.circular(Radii.lg),
          ),
          child: RadioGroup<T>(
            groupValue: value,
            onChanged: (nextValue) {
              if (enabled && nextValue != null) {
                onSelected(nextValue);
              }
            },
            child: Column(
              children: [
                for (final (index, option) in options.indexed) ...[
                  RadioListTile<T>(
                    key: option.key,
                    value: option.value,
                    enabled: enabled,
                    selected: option.value == value,
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: Grid.xs,
                      vertical: Grid.half,
                    ),
                    visualDensity: VisualDensity.standard,
                    activeColor: context.colors.primary,
                    title: Text(
                      option.label,
                      style: context.textTheme.bodyMedium?.copyWith(
                        color: enabled
                            ? context.colors.onSurface
                            : context.colors.onSurface.withValues(alpha: 0.38),
                        fontWeight: option.value == value
                            ? FontWeight.w600
                            : FontWeight.w400,
                      ),
                    ),
                  ),
                  if (index < options.length - 1)
                    Divider(
                      height: 1,
                      indent: Grid.xs,
                      endIndent: Grid.xs,
                      color: context.colors.outlineVariant,
                    ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _CreateChannelSettingMenu<T> extends StatelessWidget {
  final Key controlKey;
  final bool enabled;
  final String label;
  final ValueChanged<T> onSelected;
  final List<_CreateChannelMenuOption<T>> options;
  final T value;
  final IconData? valueIcon;
  final String valueLabel;

  const _CreateChannelSettingMenu({
    required this.controlKey,
    required this.enabled,
    required this.label,
    required this.onSelected,
    required this.options,
    required this.value,
    this.valueIcon,
    required this.valueLabel,
  });

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: context.colors.surface,
        border: Border.all(color: context.colors.outlineVariant),
        borderRadius: BorderRadius.circular(Radii.lg),
      ),
      child: PopupMenuButton<T>(
        enabled: enabled,
        initialValue: value,
        onSelected: onSelected,
        tooltip: '$label: $valueLabel',
        itemBuilder: (context) => [
          for (final option in options)
            CheckedPopupMenuItem<T>(
              checked: option.value == value,
              value: option.value,
              child: Text(option.label),
            ),
        ],
        child: Padding(
          key: controlKey,
          padding: const EdgeInsets.symmetric(
            horizontal: Grid.twelve,
            vertical: Grid.xs,
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: context.textTheme.labelLarge?.copyWith(
                    color: context.colors.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (valueIcon case final icon?) ...[
                Icon(icon, size: 16, color: context.colors.onSurfaceVariant),
                const SizedBox(width: Grid.half),
              ],
              Text(
                valueLabel,
                style: context.textTheme.bodyMedium?.copyWith(
                  color: context.colors.onSurface,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: Grid.half),
              Icon(
                LucideIcons.chevronDown,
                size: 16,
                color: context.colors.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _channelCreationMessage(BuildContext context, Object error) {
  if (error is ChannelCreationPending) {
    final submission = error.submission;
    if (submission != null) {
      if (submission.dispatchState == ActionDispatchState.UNKNOWN) {
        return _channelText(
          context,
          PlatformMessageKey.workspaceCreateUnknown,
          variables: {'operation': submission.operationId},
        );
      }
      return _channelText(
        context,
        PlatformMessageKey.workspaceCreateRecorded,
        variables: {
          'execution': submission.actionExecutionId,
          'operation': submission.operationId,
          'gate': actionGateStateValues.reverse[submission.gateState]!,
          'dispatch':
              actionDispatchStateValues.reverse[submission.dispatchState]!,
        },
      );
    }
  }
  if (error is ChannelCreationEnded) {
    final task = error.task;
    if (task.reason != null) {
      return platformReasonText(
        task.reason!,
        locale: Localizations.localeOf(context).toLanguageTag(),
      );
    }
    final key = switch (task.taskStatus) {
      TaskStatus.FAILED => PlatformMessageKey.tasksStatusFailed,
      TaskStatus.CANCELED => PlatformMessageKey.tasksStatusCanceled,
      TaskStatus.TERMINATED => PlatformMessageKey.tasksStatusTerminated,
      TaskStatus.TIMED_OUT => PlatformMessageKey.tasksStatusTimedOut,
      _ => switch (task.gateState) {
        ActionGateState.DENIED => PlatformMessageKey.tasksStatusDenied,
        ActionGateState.REVOKED => PlatformMessageKey.tasksStatusRevoked,
        ActionGateState.EXPIRED => PlatformMessageKey.tasksStatusExpired,
        _ => PlatformMessageKey.tasksStatusAborted,
      },
    };
    return _channelText(context, key);
  }
  if (error is PlatformApiError) {
    final body = error.response.error;
    if (body != null && body.errorBodyClass != ErrorClass.UNKNOWN) {
      return platformReasonText(
        body.reason,
        locale: Localizations.localeOf(context).toLanguageTag(),
      );
    }
  }
  if (error is PlatformNotSignedIn) {
    return _channelText(context, PlatformMessageKey.nativeErrorSessionEnded);
  }
  return _channelText(context, PlatformMessageKey.nativeStatusOutcomeUnknown);
}
