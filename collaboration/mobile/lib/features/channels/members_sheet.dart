// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/members_sheet.dart. Kailo: a channel's roster is its Workspace
// membership read through the BFF, one row per person over all bound keys (DD-77); member
// management is the governed `workspace.member.revoke` and `workspace.admin.grant/revoke`
// (DD-41/82), offered per person only where the role projection admits it, and Core re-admits
// every submission. Channel roles are the platform admin relation only (no owner or guest).
// Status lines come from the restored NIP-38 cache, newest visible status over the person's keys.
// The Agents section (governed agent installations) is not restored on Mobile yet.
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/platform/platform_views.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../platform/platform_async_view.dart';
import '../profile/user_status.dart';
import '../profile/user_status_cache_provider.dart';
import 'channel.dart';
import 'channel_governed_actions.dart';

class MembersSheet extends HookConsumerWidget {
  final Channel channel;
  final String? currentPubkey;

  const MembersSheet({
    super.key,
    required this.channel,
    required this.currentPubkey,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final membersAsync = ref.watch(
      platformWorkspaceMembersProvider(channel.id),
    );
    final roles = ref.watch(channelRoleMembersProvider(channel.id)).value;
    final actorPrincipalId = ref
        .watch(platformSessionViewProvider)
        .value
        ?.tenantPrincipalId;
    final people = membersAsync.asData?.value ?? const <WorkspaceMemberView>[];
    final userCache = ref.watch(userCacheProvider);
    final statusCache = ref.watch(userStatusCacheProvider);
    final bottomClearance = Grid.md + MediaQuery.viewPaddingOf(context).bottom;
    final allPubkeys = [for (final member in people) ...member.pubkeys];

    bool isSelf(WorkspaceMemberView member) =>
        member.principalId == actorPrincipalId ||
        (currentPubkey != null &&
            member.pubkeys.any(
              (pubkey) => pubkey.toLowerCase() == currentPubkey!.toLowerCase(),
            ));

    // Preload profiles for all members so avatars appear.
    useEffect(() {
      if (allPubkeys.isNotEmpty) {
        ref.read(userCacheProvider.notifier).preload(allPubkeys);
        ref.read(userStatusCacheProvider.notifier).track(allPubkeys);
      }
      return null;
    }, [allPubkeys.join('|')]);

    return Padding(
      key: const ValueKey('members-sheet-content-padding'),
      padding: const EdgeInsets.fromLTRB(Grid.gutter, 0, Grid.gutter, 0),
      child: ConstrainedBox(
        key: const ValueKey('members-sheet-viewport'),
        constraints: BoxConstraints(maxHeight: 400 + bottomClearance),
        child: membersAsync.when(
          data: (_) => ListView(
            key: const ValueKey('members-sheet-list'),
            shrinkWrap: true,
            padding: EdgeInsets.only(top: Grid.xxs, bottom: bottomClearance),
            children: [
              if (people.isNotEmpty) ...[
                _SectionLabel(
                  label: platformText(
                    PlatformMessageKey.channelMembersMembersCount,
                    locale: locale,
                    variables: {'count': people.length},
                  ),
                ),
                for (final member in people)
                  _MemberTile(
                    member: member,
                    role: roles?[member.principalId],
                    profile: member.pubkeys.isEmpty
                        ? null
                        : userCache[member.pubkeys.first.toLowerCase()],
                    isSelf: isSelf(member),
                    channel: channel,
                    userStatus: _newestStatus(statusCache, member.pubkeys),
                  ),
              ],
              if (people.isEmpty)
                Center(
                  child: Text(
                    platformText(
                      PlatformMessageKey.channelMembersNone,
                      locale: locale,
                    ),
                    style: context.textTheme.bodySmall?.copyWith(
                      color: context.colors.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
          loading: () => Center(
            child: BuzzLoadingIndicator(
              size: 44,
              semanticLabel: platformText(
                PlatformMessageKey.channelMembersLoading,
                locale: locale,
              ),
            ),
          ),
          error: (error, _) => Center(
            child: Text(
              platformErrorText(error, locale: locale),
              style: context.textTheme.bodySmall?.copyWith(
                color: context.colors.error,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// DD-120 (5): a person with several bound keys shows the newest visible status.
UserStatus? _newestStatus(
  Map<String, UserStatus?> cache,
  List<String> pubkeys,
) {
  UserStatus? newest;
  for (final pubkey in pubkeys) {
    final status = cache[pubkey.toLowerCase()];
    if (status == null || status.isEmpty) continue;
    if (newest == null || status.updatedAt > newest.updatedAt) newest = status;
  }
  return newest;
}

class _SectionLabel extends StatelessWidget {
  final String label;

  const _SectionLabel({required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: Grid.half, bottom: Grid.half),
      child: Text(
        label,
        style: context.textTheme.labelMedium?.copyWith(
          color: context.colors.onSurfaceVariant,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _MemberTile extends ConsumerWidget {
  final WorkspaceMemberView member;
  final RoleMemberView? role;
  final UserProfile? profile;
  final bool isSelf;
  final Channel channel;
  final UserStatus? userStatus;

  const _MemberTile({
    required this.member,
    required this.role,
    required this.profile,
    required this.isSelf,
    required this.channel,
    this.userStatus,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final label = isSelf
        ? platformText(PlatformMessageKey.channelMembersYou, locale: locale)
        : member.displayName;
    final initial = label.isEmpty ? '?' : label.characters.first.toUpperCase();
    final active = member.state == WorkspaceMembershipState.ACTIVE;
    final canRemove = role?.canRemoveFromWorkspace == true;
    final canChangeRole =
        role?.canGrantWorkspaceAdmin == true ||
        role?.canRevokeWorkspaceAdmin == true;
    final showManagementActions =
        active &&
        !isSelf &&
        !channel.isArchived &&
        (canRemove || canChangeRole);
    final roleLabel = !active
        ? platformWorkspaceMembershipStateText(member.state, locale: locale)
        : platformText(
            role?.workspaceAdmin == true
                ? PlatformMessageKey.channelMembersRoleAdmin
                : PlatformMessageKey.channelMembersRoleMember,
            locale: locale,
          );
    final status = userStatus;

    return ListTile(
      key: ValueKey('channel-member-${member.principalId}'),
      contentPadding: EdgeInsets.zero,
      leading: AvatarImage(
        imageUrl: profile?.avatarUrl,
        radius: 20,
        fallback: Text(initial),
      ),
      title: Text(label),
      subtitle: status != null
          ? Text(
              '${status.emoji.isNotEmpty ? '${status.emoji} ' : ''}${status.text}',
              style: context.textTheme.bodySmall?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            )
          : Text(
              roleLabel,
              style: context.textTheme.bodySmall?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
      trailing: showManagementActions
          ? IconButton(
              key: ValueKey('channel-member-menu-${member.principalId}'),
              icon: const Icon(LucideIcons.ellipsis, size: 18),
              onPressed: () => _showMemberActions(
                context,
                ref,
                label: label,
                canRemove: canRemove,
                canChangeRole: canChangeRole,
              ),
              visualDensity: VisualDensity.compact,
            )
          : null,
    );
  }

  Future<void> _submit(
    BuildContext context,
    WidgetRef ref,
    String actionKey,
  ) async {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final messenger = ScaffoldMessenger.maybeOf(context);
    final outcome = await ref
        .read(channelGovernedActionsProvider)
        .changeMember(
          workspaceId: channel.id,
          principalId: member.principalId,
          actionKey: actionKey,
        );
    if (outcome == null) return;
    messenger?.showSnackBar(
      SnackBar(
        content: Text(channelActionOutcomeText(outcome, locale: locale)),
      ),
    );
  }

  void _showMemberActions(
    BuildContext context,
    WidgetRef ref, {
    required String label,
    required bool canRemove,
    required bool canChangeRole,
  }) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);
    final isAdmin = role?.workspaceAdmin == true;
    showBuzzModalBottomSheet<void>(
      context: context,
      title: label,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (canChangeRole) ...[
              const SizedBox(height: Grid.xxs),
              _RoleSelector(
                isAdmin: isAdmin,
                canGrant: role?.canGrantWorkspaceAdmin == true,
                canRevoke: role?.canRevokeWorkspaceAdmin == true,
                onChanged: (admin) async {
                  Navigator.of(sheetContext).pop();
                  await _submit(
                    context,
                    ref,
                    admin
                        ? workspaceAdminGrantAction
                        : workspaceAdminRevokeAction,
                  );
                },
              ),
              const SizedBox(height: Grid.xs),
            ],
            if (canRemove)
              ListTile(
                key: const ValueKey('channel-member-remove'),
                leading: Icon(
                  LucideIcons.userMinus,
                  size: 18,
                  color: context.colors.error,
                ),
                title: Text(
                  t(PlatformMessageKey.channelMembersRemove),
                  style: TextStyle(color: context.colors.error),
                ),
                onTap: () async {
                  Navigator.of(sheetContext).pop();
                  final confirmed = await showBuzzDialog<bool>(
                    context: context,
                    builder: (dialogContext) => AlertDialog(
                      title: Text(
                        t(PlatformMessageKey.channelMembersRemoveTitle),
                      ),
                      content: Text(
                        t(PlatformMessageKey.channelMembersRemoveConfirm, {
                          'name': label,
                        }),
                      ),
                      actions: [
                        TextButton(
                          onPressed: () =>
                              Navigator.of(dialogContext).pop(false),
                          child: Text(t(PlatformMessageKey.buzzCancel)),
                        ),
                        TextButton(
                          onPressed: () =>
                              Navigator.of(dialogContext).pop(true),
                          child: Text(
                            t(PlatformMessageKey.channelMembersRemoveAction),
                            style: TextStyle(color: context.colors.error),
                          ),
                        ),
                      ],
                    ),
                  );
                  if (confirmed == true && context.mounted) {
                    await _submit(context, ref, workspaceMemberRevokeAction);
                  }
                },
              ),
            const SizedBox(height: Grid.xxs),
          ],
        ),
      ),
    );
  }
}

class _RoleSelector extends StatelessWidget {
  final bool isAdmin;
  final bool canGrant;
  final bool canRevoke;
  final ValueChanged<bool> onChanged;

  const _RoleSelector({
    required this.isAdmin,
    required this.canGrant,
    required this.canRevoke,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            platformText(
              PlatformMessageKey.channelMembersChangeRole,
              locale: locale,
            ),
            style: context.textTheme.labelMedium?.copyWith(
              color: context.colors.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: Grid.xxs),
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<bool>(
              segments: [
                ButtonSegment<bool>(
                  value: true,
                  enabled: isAdmin || canGrant,
                  label: Text(
                    platformText(
                      PlatformMessageKey.channelMembersRoleAdmin,
                      locale: locale,
                    ),
                  ),
                ),
                ButtonSegment<bool>(
                  value: false,
                  enabled: !isAdmin || canRevoke,
                  label: Text(
                    platformText(
                      PlatformMessageKey.channelMembersRoleMember,
                      locale: locale,
                    ),
                  ),
                ),
              ],
              selected: {isAdmin},
              showSelectedIcon: false,
              style: ButtonStyle(
                visualDensity: VisualDensity.compact,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                textStyle: WidgetStatePropertyAll(context.textTheme.labelSmall),
              ),
              onSelectionChanged: (selection) {
                if (selection.isEmpty) return;
                final admin = selection.single;
                if (admin == isAdmin) return;
                onChanged(admin);
              },
            ),
          ),
        ],
      ),
    );
  }
}
