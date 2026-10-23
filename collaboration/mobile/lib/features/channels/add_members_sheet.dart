// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/add_members_sheet.dart. Kailo: candidates are the role
// projection's people the caller may add (`canAddToWorkspace`, fail closed: no admitted
// candidate, nobody listed), and each selected person is one governed `workspace.member.add`
// (DD-41) with its own idempotency key. A person whose outcome is unknown stays selected and
// the next submit resends that same command; recorded or waiting is not yet a member, so the
// sheet closes with the status line instead of claiming the roster changed.
import 'dart:async';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import 'channel_governed_actions.dart';

/// Searchable multi-select used to add people to a channel.
class AddChannelMembersSheet extends HookConsumerWidget {
  const AddChannelMembersSheet({
    super.key,
    required this.channelId,
    required this.existingPrincipalIds,
  });

  final String channelId;
  final Set<String> existingPrincipalIds;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);
    final actions = ref.watch(channelGovernedActionsProvider);
    final queryController = useTextEditingController();
    final query = useState('');
    final debouncedQuery = useState('');
    final selected = useState<List<RoleMemberView>>([]);
    final isSubmitting = useState(false);
    final submitError = useState<String?>(null);
    final submitted = useState<Set<String>>(<String>{});

    useEffect(() {
      final timer = Timer(const Duration(milliseconds: 250), () {
        debouncedQuery.value = query.value.trim().toLowerCase();
      });
      return timer.cancel;
    }, [query.value]);

    final rolesAsync = ref.watch(channelRoleMembersProvider(channelId));
    final normalizedQuery = debouncedQuery.value;
    final selectedIds = {for (final role in selected.value) role.principalId};
    final excluded = {...existingPrincipalIds, ...submitted.value};
    final available = [
      for (final role in rolesAsync.asData?.value?.values ?? <RoleMemberView>[])
        if (role.canAddToWorkspace == true &&
            !excluded.contains(role.principalId) &&
            (normalizedQuery.isEmpty ||
                role.displayName.toLowerCase().contains(normalizedQuery)))
          role,
    ]..sort((a, b) => a.displayName.compareTo(b.displayName));

    void toggle(RoleMemberView role) {
      if (isSubmitting.value) return;
      selected.value = selectedIds.contains(role.principalId)
          ? [
              for (final item in selected.value)
                if (item.principalId != role.principalId) item,
            ]
          : [...selected.value, role];
      submitError.value = null;
    }

    Future<void> addSelectedMembers() async {
      if (selected.value.isEmpty || isSubmitting.value) return;
      final batch = List<RoleMemberView>.of(selected.value);
      isSubmitting.value = true;
      submitError.value = null;
      final remaining = <RoleMemberView>[];
      final done = <String>{};
      ChannelActionOutcome? firstDone;
      ChannelActionOutcome? firstFailure;
      try {
        for (final role in batch) {
          final outcome = await actions.changeMember(
            workspaceId: channelId,
            principalId: role.principalId,
            actionKey: workspaceMemberAddAction,
          );
          if (outcome is ChannelActionRecorded ||
              outcome is ChannelActionWaiting) {
            done.add(role.principalId);
            firstDone ??= outcome;
          } else {
            remaining.add(role);
            firstFailure ??= outcome;
          }
        }
      } finally {
        if (context.mounted) {
          isSubmitting.value = false;
          submitted.value = {...submitted.value, ...done};
          selected.value = remaining;
        }
      }
      if (!context.mounted) return;
      final failure = firstFailure;
      if (failure != null) {
        submitError.value = channelActionOutcomeText(failure, locale: locale);
        return;
      }
      final messenger = ScaffoldMessenger.maybeOf(context);
      Navigator.of(context).pop(true);
      if (firstDone case final outcome?) {
        messenger?.showSnackBar(
          SnackBar(
            content: Text(channelActionOutcomeText(outcome, locale: locale)),
          ),
        );
      }
    }

    final retrying = selected.value.any(
      (role) =>
          actions.retained(
            '$workspaceMemberAddAction:$channelId:${role.principalId}',
          ) !=
          null,
    );

    return Padding(
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        0,
        Grid.gutter,
        MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SafeArea(
        top: false,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.72,
          ),
          child: Column(
            children: [
              TextField(
                key: const ValueKey('add-channel-members-search'),
                controller: queryController,
                autofocus: true,
                autocorrect: false,
                enableSuggestions: false,
                enabled: !isSubmitting.value,
                onChanged: (value) => query.value = value,
                decoration: InputDecoration(
                  hintText: t(PlatformMessageKey.channelMembersSearchPeople),
                  prefixIcon: const Icon(LucideIcons.search),
                ),
              ),
              if (selected.value.isNotEmpty) ...[
                const SizedBox(height: Grid.xxs),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Wrap(
                    spacing: Grid.half,
                    runSpacing: Grid.half,
                    children: [
                      for (final role in selected.value)
                        InputChip(
                          key: ValueKey(
                            'add-channel-member-selected-${role.principalId}',
                          ),
                          label: Text(role.displayName),
                          onDeleted: isSubmitting.value
                              ? null
                              : () => toggle(role),
                        ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: Grid.xxs),
              Expanded(
                child: rolesAsync.when(
                  data: (_) => available.isEmpty
                      ? Center(
                          child: Text(
                            t(
                              normalizedQuery.isEmpty
                                  ? PlatformMessageKey
                                        .channelMembersNoneAvailable
                                  : PlatformMessageKey
                                        .channelMembersNoMatchPeople,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        )
                      : ListView.builder(
                          key: const ValueKey('add-channel-members-results'),
                          itemCount: available.length,
                          itemBuilder: (context, index) {
                            final role = available[index];
                            final isSelected = selectedIds.contains(
                              role.principalId,
                            );
                            final name = role.displayName;
                            return Semantics(
                              key: ValueKey(
                                'add-channel-member-${role.principalId}',
                              ),
                              button: true,
                              selected: isSelected,
                              label: name,
                              child: ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: AvatarImage(
                                  imageUrl: null,
                                  radius: 20,
                                  backgroundColor:
                                      context.colors.primaryContainer,
                                  fallback: Text(
                                    name.isEmpty
                                        ? '?'
                                        : name.characters.first.toUpperCase(),
                                  ),
                                ),
                                title: Text(
                                  name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                trailing: Icon(
                                  isSelected
                                      ? LucideIcons.circleCheck
                                      : LucideIcons.plus,
                                  color: isSelected
                                      ? context.colors.primary
                                      : context.colors.onSurfaceVariant,
                                ),
                                onTap: () => toggle(role),
                              ),
                            );
                          },
                        ),
                  loading: () => Center(
                    child: BuzzLoadingIndicator(
                      size: 44,
                      semanticLabel: t(
                        PlatformMessageKey.channelMembersLoading,
                      ),
                    ),
                  ),
                  error: (error, _) => Center(
                    child: Text(
                      t(PlatformMessageKey.channelMembersLoadPeopleFailed),
                      style: context.textTheme.bodyMedium?.copyWith(
                        color: context.colors.error,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              ),
              if (submitError.value case final error?) ...[
                const SizedBox(height: Grid.xxs),
                Text(
                  error,
                  key: const ValueKey('add-channel-members-error'),
                  style: context.textTheme.bodySmall?.copyWith(
                    color: context.colors.error,
                  ),
                ),
              ],
              const SizedBox(height: Grid.xxs),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: const ValueKey('add-channel-members-submit'),
                  onPressed: selected.value.isEmpty || isSubmitting.value
                      ? null
                      : addSelectedMembers,
                  child: Text(
                    isSubmitting.value
                        ? t(PlatformMessageKey.channelMembersAdding)
                        : retrying
                        ? t(PlatformMessageKey.workspaceCreateRetry)
                        : selected.value.length == 1
                        ? t(PlatformMessageKey.channelMembersAddOne)
                        : t(PlatformMessageKey.channelMembersAddMany, {
                            'count': selected.value.length,
                          }),
                  ),
                ),
              ),
              const SizedBox(height: Grid.xxs),
            ],
          ),
        ),
      ),
    );
  }
}
