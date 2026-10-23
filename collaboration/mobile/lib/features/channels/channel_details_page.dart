// Buzz 779af8886caae1317b4de962082429867ab61503
// mobile/lib/features/channels/channel_details_page.dart (a part of channel_actions_sheet.dart
// upstream; its own library here because Kailo's actions sheet is not the original library).
// Kailo: the roster preview and count are the BFF Workspace members, one row per person
// (DD-77). Every management entry is a governed action shown only for its BFF hint
// (channel_governed_actions.dart): Edit opens the manage sheet (`workspace.update`), Add members
// lists only admitted candidates (`workspace.member.add`), Join/Leave are `workspace.join/leave`,
// Archive/Unarchive are `workspace.suspend/restore` (DD-119). A recorded request is not done:
// the page reports it and rereads. Star, Mute and "Move to section…" are the caller's
// CollaborationUserState preferences (workspace_preferences, sidebar_sections; DD-40,
// DD-150(3)), shown only from a Core readback.
import 'dart:async';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/clipboard_utils.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/buzz_action_tile.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../../shared/widgets/ios_glass_navigation_button.dart';
import '../../shared/widgets/lucide_star_icon.dart';
import '../../shared/widgets/modal_presentation.dart';
import 'add_members_sheet.dart';
import 'channel.dart';
import 'channel_sections/channel_section_sheets.dart';
import 'channel_governed_actions.dart';
import 'direct_messages.dart';
import 'manage_channel_sheet.dart';
import 'members_sheet.dart';

const _channelMemberPreviewLimit = 5;
const _channelDetailsHeaderFrostScrollDistance = Grid.xxl;
const _channelDetailsHeaderFrostMaxBlurSigma = 20.0;
const _channelDetailsSectionPadding = Grid.twelve;

/// Opens the combined mobile channel settings page.
Future<bool?> showChannelDetailsPage({
  required BuildContext context,
  required Channel channel,
  required String? currentPubkey,
  required void Function(BuildContext context, String pubkey) onMemberTap,
}) => Navigator.of(context).push<bool>(
  MaterialPageRoute<bool>(
    builder: (_) => ChannelDetailsPage(
      channel: channel,
      currentPubkey: currentPubkey,
      onMemberTap: onMemberTap,
    ),
  ),
);

/// Combined channel identity, membership, organization, and lifecycle page.
class ChannelDetailsPage extends HookConsumerWidget {
  const ChannelDetailsPage({
    super.key,
    required this.channel,
    required this.currentPubkey,
    required this.onMemberTap,
  });

  final Channel channel;
  final String? currentPubkey;
  final void Function(BuildContext context, String pubkey) onMemberTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String t(PlatformMessageKey key, [Map<String, Object>? variables]) =>
        platformText(key, locale: locale, variables: variables);
    final resolvedChannel = channel;
    final scrollController = useScrollController();
    final heroNameKey = useMemoized(GlobalKey.new);
    final collapsedTitleOffset = useRef<double?>(null);
    final showCollapsedTitle = useState(false);
    final headerFrostProgress = useState(0.0);
    final lifecycleBusy = useState(false);
    final preferences = ref.watch(collaborationPreferencesProvider);
    final starred = resolvedChannel.channelType == 'stream'
        ? preferences.starred(resolvedChannel.id)
        : null;
    final muted = preferences.workspaceMuted(resolvedChannel.id);
    final sections = ref.watch(channelSectionsProvider);
    final membersAsync = ref.watch(
      platformWorkspaceMembersProvider(resolvedChannel.id),
    );
    final members = [
      for (final member
          in membersAsync.asData?.value ?? const <WorkspaceMemberView>[])
        if (member.state == WorkspaceMembershipState.ACTIVE) member,
    ];
    final hintsAsync = ref.watch(
      channelManagementHintsProvider(resolvedChannel.id),
    );
    final hints = hintsAsync.asData?.value;
    final roles = ref.watch(channelRoleMembersProvider(resolvedChannel.id));
    final actorPrincipalId = ref
        .watch(platformSessionViewProvider)
        .value
        ?.tenantPrincipalId;
    final canEdit =
        hints != null && (hints.updateActionKey != null || hints.canReopen);
    final canAddMembers =
        !resolvedChannel.isArchived &&
        (roles.asData?.value?.values.any(
              (role) => role.canAddToWorkspace == true,
            ) ??
            false);
    final lifecycle = hints?.lifecycleActionKey;
    final canArchive =
        !resolvedChannel.isArchived &&
        lifecycle == WorkspaceLifecycleActionKey.WORKSPACE_SUSPEND;
    final canUnarchive =
        resolvedChannel.isArchived &&
        lifecycle == WorkspaceLifecycleActionKey.WORKSPACE_RESTORE;
    // DD-150: the original deleteChannel over the governed workspace.delete; a converging delete
    // keeps the channel listed as deleting instead of offering it again.
    final deleting = hints?.deleting ?? false;
    final canDelete = hints?.deleteActionKey != null && !deleting;
    final canJoin = hints?.joinActionKey != null;
    final canLeave = hints?.leaveActionKey != null;
    final memberCount = membersAsync.hasValue
        ? members.length
        : resolvedChannel.memberCount;
    final memberLabel = t(
      platformPluralOne(memberCount, locale: locale)
          ? PlatformMessageKey.channelManagementMemberCountOne
          : PlatformMessageKey.channelManagementMemberCountOther,
      {'count': memberCount},
    );
    final previewMembers = members.take(_channelMemberPreviewLimit).toList();
    final userCache = ref.watch(userCacheProvider);
    final previewPubkeys = [
      for (final member in previewMembers)
        if (member.pubkeys.isNotEmpty) member.pubkeys.first,
    ];

    useEffect(() {
      if (previewPubkeys.isNotEmpty) {
        ref.read(userCacheProvider.notifier).preload(previewPubkeys);
      }
      return null;
    }, [previewPubkeys.join('|')]);

    useEffect(() {
      void updateCollapsedTitle() {
        final nextFrostProgress = !scrollController.hasClients
            ? 0.0
            : (scrollController.offset /
                      _channelDetailsHeaderFrostScrollDistance)
                  .clamp(0.0, 1.0)
                  .toDouble();
        if ((headerFrostProgress.value - nextFrostProgress).abs() > 0.001) {
          headerFrostProgress.value = nextFrostProgress;
        }

        final threshold = collapsedTitleOffset.value;
        if (threshold == null || !context.mounted) return;
        final nextValue = scrollController.offset >= threshold;
        if (showCollapsedTitle.value != nextValue) {
          showCollapsedTitle.value = nextValue;
        }
      }

      collapsedTitleOffset.value = null;
      scrollController.addListener(updateCollapsedTitle);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final nameContext = heroNameKey.currentContext;
        final renderBox = nameContext?.findRenderObject() as RenderBox?;
        if (renderBox == null || !renderBox.hasSize || !context.mounted) {
          return;
        }
        final nameBottom = renderBox
            .localToGlobal(Offset(0, renderBox.size.height))
            .dy;
        collapsedTitleOffset.value =
            scrollController.offset + nameBottom - frostedAppBarHeight(context);
        updateCollapsedTitle();
      });
      return () => scrollController.removeListener(updateCollapsedTitle);
    }, [scrollController, resolvedChannel.name]);

    void showOutcome(ChannelActionOutcome outcome) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(
          content: Text(channelActionOutcomeText(outcome, locale: locale)),
        ),
      );
    }

    Future<void> openMembers() => showBuzzModalBottomSheet<void>(
      context: context,
      title: t(PlatformMessageKey.channelMembersMembers),
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) =>
          MembersSheet(channel: resolvedChannel, currentPubkey: currentPubkey),
    );

    Future<void> openAddMembers() async {
      final mediaQuery = MediaQuery.of(context);
      await showBuzzModalBottomSheet<bool>(
        context: context,
        title: t(PlatformMessageKey.channelMembersAddTitle),
        isScrollControlled: true,
        showDragHandle: true,
        constraints: BoxConstraints(
          maxWidth: 640,
          maxHeight:
              mediaQuery.size.height - mediaQuery.viewPadding.top - Grid.xs,
        ),
        builder: (_) => AddChannelMembersSheet(
          channelId: resolvedChannel.id,
          existingPrincipalIds: {
            for (final member
                in membersAsync.asData?.value ?? const <WorkspaceMemberView>[])
              member.principalId,
          },
        ),
      );
    }

    Future<void> openManageChannel() async {
      final current = hints;
      if (current == null) return;
      await showBuzzModalBottomSheet<bool>(
        context: context,
        title: t(PlatformMessageKey.channelManagementManage),
        isScrollControlled: true,
        showDragHandle: true,
        constraints: BoxConstraints(
          maxWidth: 640,
          maxHeight: MediaQuery.sizeOf(context).height * 0.9,
        ),
        builder: (_) =>
            ManageChannelSheet(channel: resolvedChannel, hints: current),
      );
    }

    Future<void> toggleStar() async {
      final current = starred;
      if (current == null ||
          preferences.busy ||
          preferences.pendingId != null) {
        return;
      }
      await ref
          .read(collaborationPreferencesProvider.notifier)
          .setStarred(resolvedChannel.id, !current);
    }

    Future<void> toggleMute() async {
      final current = muted;
      if (current == null ||
          preferences.busy ||
          preferences.pendingId != null) {
        return;
      }
      await ref
          .read(collaborationPreferencesProvider.notifier)
          .setWorkspaceMuted(resolvedChannel.id, !current);
    }

    Future<void> runLifecycle(
      Future<ChannelActionOutcome?> Function() submit, {
      bool closeWhenRecorded = false,
    }) async {
      if (lifecycleBusy.value) return;
      lifecycleBusy.value = true;
      final ChannelActionOutcome? outcome;
      try {
        outcome = await submit();
      } finally {
        if (context.mounted) lifecycleBusy.value = false;
      }
      if (outcome == null || !context.mounted) return;
      showOutcome(outcome);
      if (closeWhenRecorded &&
          (outcome is ChannelActionRecorded ||
              outcome is ChannelActionWaiting)) {
        Navigator.of(context).pop(true);
      }
    }

    // Read when used: the provider needs a signed-in platform session.
    ChannelGovernedActions actions() =>
        ref.read(channelGovernedActionsProvider);
    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    final usesNativeIosGlassBackButton =
        Navigator.canPop(context) &&
        Theme.of(context).platform == TargetPlatform.iOS;
    return FrostedScaffold(
      useUtilitySurfaceTheme: true,
      appBar: FrostedAppBar(
        centerTitle: true,
        leading: usesNativeIosGlassBackButton
            ? IosGlassNavigationButton(
                key: const ValueKey('channel-details-ios-glass-back'),
                icon: IosGlassNavigationIcon.back,
                semanticLabel: t(PlatformMessageKey.channelDetailsBack),
                onPressed: () => Navigator.of(context).maybePop(),
                width: iosGlassChannelHeaderLeadingWidth,
                buttonCenterX: iosGlassChannelHeaderButtonCenterX,
              )
            : null,
        iconColor: context.colors.primary,
        actions: [
          SizedBox(
            width: usesNativeIosGlassBackButton
                ? iosGlassChannelHeaderLeadingWidth
                : 48,
            height: 48,
          ),
        ],
        frosted: headerFrostProgress.value > 0,
        frostedSurfaceOpacity: 0.5 * headerFrostProgress.value,
        frostedBlurSigma:
            _channelDetailsHeaderFrostMaxBlurSigma * headerFrostProgress.value,
        showBottomDivider: headerFrostProgress.value > 0,
        bottomDividerOpacity: 0.07 * headerFrostProgress.value,
        title: AnimatedSwitcher(
          duration: reducedMotion
              ? Duration.zero
              : const Duration(milliseconds: 160),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeOutCubic,
          child: showCollapsedTitle.value
              ? Text(
                  resolvedChannel.name,
                  key: const ValueKey('channel-details-collapsed-title'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                )
              : const SizedBox(
                  key: ValueKey('channel-details-expanded-title-space'),
                ),
        ),
      ),
      body: ListView(
        key: const ValueKey('channel-details-page-list'),
        controller: scrollController,
        padding: EdgeInsets.only(
          top: frostedAppBarHeight(context) + Grid.xs,
          bottom: MediaQuery.viewPaddingOf(context).bottom + Grid.xs,
        ),
        children: [
          _ChannelDetailsHero(channel: resolvedChannel, nameKey: heroNameKey),
          Padding(
            key: const ValueKey('channel-details-actions'),
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              _channelDetailsSectionPadding,
              Grid.gutter,
              _channelDetailsSectionPadding,
            ),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: BuzzActionTile(
                      key: const ValueKey('channel-details-star-action'),
                      icon: null,
                      iconWidget: LucideStarIcon(
                        filled: starred == true,
                        color: starred == true
                            ? context.colors.primary
                            : context.colors.onSurface,
                      ),
                      label: t(
                        starred == true
                            ? PlatformMessageKey.nativeChannelUnstar
                            : PlatformMessageKey.nativeChannelStar,
                      ),
                      isEnabled:
                          starred != null &&
                          !preferences.busy &&
                          preferences.pendingId == null,
                      onTap: () => unawaited(toggleStar()),
                    ),
                  ),
                  const SizedBox(width: Grid.xxs),
                  Expanded(
                    child: BuzzActionTile(
                      key: const ValueKey('channel-details-mute-action'),
                      icon: muted == true
                          ? LucideIcons.bell
                          : LucideIcons.bellOff,
                      iconColor: muted == true ? context.colors.primary : null,
                      label: t(
                        muted == true
                            ? PlatformMessageKey.channelDetailsUnmute
                            : PlatformMessageKey.channelDetailsMute,
                      ),
                      isEnabled:
                          muted != null &&
                          !preferences.busy &&
                          preferences.pendingId == null,
                      onTap: () => unawaited(toggleMute()),
                    ),
                  ),
                  const SizedBox(width: Grid.xxs),
                  Expanded(
                    child: BuzzActionTile(
                      key: const ValueKey('channel-details-edit-action'),
                      icon: LucideIcons.pencil,
                      label: t(PlatformMessageKey.channelDetailsEdit),
                      isEnabled: canEdit,
                      onTap: () => unawaited(openManageChannel()),
                    ),
                  ),
                ],
              ),
            ),
          ),
          AppListCard(
            key: const ValueKey('channel-details-members-card'),
            label: memberLabel,
            dividerIndent: Grid.xs + 40 + Grid.xs,
            verticalPadding: _channelDetailsSectionPadding,
            children: [
              if (canAddMembers)
                AppListRowRaw(
                  key: const ValueKey('channel-details-add-members-row'),
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: context.colors.surfaceContainer,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      LucideIcons.plus,
                      color: context.colors.onSurfaceVariant,
                    ),
                  ),
                  title: Text(
                    t(PlatformMessageKey.channelMembersAddTitle),
                    style: context.textTheme.bodyLarge,
                  ),
                  trailing: const _ChannelDetailsChevron(),
                  onTap: openAddMembers,
                  verticalPadding: Grid.xxs,
                ),
              if (membersAsync.isLoading && members.isEmpty)
                AppListRow(
                  icon: LucideIcons.loaderCircle,
                  title: t(PlatformMessageKey.channelMembersLoading),
                  trailing: BuzzLoadingIndicator(
                    size: 20,
                    semanticLabel: t(PlatformMessageKey.channelMembersLoading),
                  ),
                )
              else if (membersAsync.hasError && members.isEmpty)
                AppListRow(
                  icon: LucideIcons.triangleAlert,
                  title: t(PlatformMessageKey.channelDetailsMembersUnavailable),
                )
              else ...[
                for (final member in previewMembers)
                  _ChannelMemberPreviewRow(
                    key: ValueKey(
                      'channel-details-member-${member.principalId}',
                    ),
                    member: member,
                    isSelf:
                        member.principalId == actorPrincipalId ||
                        member.pubkeys.any(
                          (pubkey) =>
                              pubkey.toLowerCase() ==
                              currentPubkey?.toLowerCase(),
                        ),
                    isAdmin:
                        roles
                            .asData
                            ?.value?[member.principalId]
                            ?.workspaceAdmin ==
                        true,
                    onMemberTap: onMemberTap,
                    avatarUrl: member.pubkeys.isEmpty
                        ? null
                        : userCache[member.pubkeys.first.toLowerCase()]
                              ?.avatarUrl,
                  ),
                AppListRowRaw(
                  key: const ValueKey('channel-details-members-row'),
                  leading: const SizedBox.square(dimension: 40),
                  title: Text(
                    t(PlatformMessageKey.channelDetailsSeeAll),
                    style: context.textTheme.bodyLarge,
                  ),
                  trailing: const _ChannelDetailsChevron(),
                  onTap: openMembers,
                  verticalPadding: Grid.xxs,
                ),
              ],
            ],
          ),
          AppListCard(
            key: const ValueKey('channel-details-channel-card'),
            verticalPadding: _channelDetailsSectionPadding,
            children: [
              AppListRow(
                key: const ValueKey('channel-details-move-section-row'),
                icon: LucideIcons.folderInput,
                title: t(PlatformMessageKey.sidebarSectionMoveTo),
                trailing: const _ChannelDetailsChevron(),
                onTap: sections.writable
                    ? () => unawaited(
                        showMoveToSectionSheet(
                          context,
                          channel: resolvedChannel,
                        ),
                      )
                    : null,
              ),
              AppListRow(
                icon: LucideIcons.copy,
                title: t(PlatformMessageKey.channelDetailsCopyName),
                onTap: () {
                  copyToClipboard(
                    context,
                    resolvedChannel.name,
                    message: t(PlatformMessageKey.channelDetailsNameCopied),
                  );
                },
              ),
              AppListRow(
                icon: LucideIcons.hash,
                title: t(PlatformMessageKey.channelDetailsCopyId),
                onTap: () {
                  copyToClipboard(
                    context,
                    resolvedChannel.id,
                    message: t(PlatformMessageKey.channelDetailsIdCopied),
                  );
                },
              ),
            ],
          ),
          if (canJoin ||
              canLeave ||
              hintsAsync.isLoading ||
              hintsAsync.hasError ||
              canArchive ||
              canUnarchive ||
              canDelete ||
              deleting)
            AppListCard(
              key: const ValueKey('channel-details-lifecycle-card'),
              verticalPadding: _channelDetailsSectionPadding,
              children: [
                if (hintsAsync.isLoading && hints == null)
                  AppListRow(
                    icon: LucideIcons.loaderCircle,
                    title: t(PlatformMessageKey.channelDetailsActionsLoading),
                    trailing: BuzzLoadingIndicator(
                      size: 20,
                      semanticLabel: t(
                        PlatformMessageKey.channelDetailsActionsLoading,
                      ),
                    ),
                  )
                else if (hintsAsync.hasError && hints == null)
                  AppListRow(
                    icon: LucideIcons.triangleAlert,
                    title: t(
                      PlatformMessageKey.channelDetailsActionsUnavailable,
                    ),
                  )
                else ...[
                  if (canJoin)
                    AppListRow(
                      key: const ValueKey('channel-details-join'),
                      icon: LucideIcons.logIn,
                      title: t(
                        lifecycleBusy.value
                            ? PlatformMessageKey.channelManagementJoining
                            : PlatformMessageKey.channelManagementJoin,
                      ),
                      onTap: lifecycleBusy.value
                          ? null
                          : () => runLifecycle(
                              () => actions().joinChannel(resolvedChannel.id),
                            ),
                    ),
                  if (canLeave)
                    AppListRow(
                      key: const ValueKey('channel-details-leave'),
                      icon: LucideIcons.logOut,
                      title: t(PlatformMessageKey.channelManagementLeave),
                      titleColor: context.colors.error,
                      onTap: lifecycleBusy.value
                          ? null
                          : () => _confirmAndRun(
                              context,
                              title: t(
                                PlatformMessageKey.channelDetailsLeaveTitle,
                                {'name': resolvedChannel.name},
                              ),
                              body: t(
                                PlatformMessageKey.channelDetailsLeaveBody,
                              ),
                              confirmLabel: t(
                                PlatformMessageKey.channelDetailsLeaveConfirm,
                              ),
                              cancelLabel: t(PlatformMessageKey.buzzCancel),
                              action: () => runLifecycle(
                                () =>
                                    actions().leaveChannel(resolvedChannel.id),
                                closeWhenRecorded: true,
                              ),
                            ),
                    ),
                  if (canArchive)
                    AppListRow(
                      key: const ValueKey('channel-details-archive'),
                      icon: LucideIcons.archive,
                      title: t(PlatformMessageKey.channelManagementArchive),
                      onTap: lifecycleBusy.value
                          ? null
                          : () => _confirmAndRun(
                              context,
                              title: t(
                                PlatformMessageKey.channelManagementArchive,
                              ),
                              body: t(
                                PlatformMessageKey
                                    .channelManagementConfirmArchive,
                                {'name': resolvedChannel.name},
                              ),
                              confirmLabel: t(
                                PlatformMessageKey.channelDetailsArchiveConfirm,
                              ),
                              cancelLabel: t(PlatformMessageKey.buzzCancel),
                              action: () => runLifecycle(
                                () => actions().changeLifecycle(
                                  resolvedChannel.id,
                                  WorkspaceLifecycleActionKey.WORKSPACE_SUSPEND,
                                ),
                              ),
                            ),
                    ),
                  if (canUnarchive)
                    AppListRow(
                      key: const ValueKey('channel-details-unarchive'),
                      icon: LucideIcons.archiveRestore,
                      title: t(PlatformMessageKey.channelManagementUnarchive),
                      onTap: lifecycleBusy.value
                          ? null
                          : () => _confirmAndRun(
                              context,
                              title: t(
                                PlatformMessageKey.channelManagementUnarchive,
                              ),
                              body: t(
                                PlatformMessageKey
                                    .channelManagementConfirmUnarchive,
                                {'name': resolvedChannel.name},
                              ),
                              confirmLabel: t(
                                PlatformMessageKey
                                    .channelDetailsUnarchiveConfirm,
                              ),
                              cancelLabel: t(PlatformMessageKey.buzzCancel),
                              action: () => runLifecycle(
                                () => actions().changeLifecycle(
                                  resolvedChannel.id,
                                  WorkspaceLifecycleActionKey.WORKSPACE_RESTORE,
                                ),
                              ),
                            ),
                    ),
                  if (deleting)
                    AppListRow(
                      key: const ValueKey('channel-details-deleting'),
                      icon: LucideIcons.loaderCircle,
                      title: t(PlatformMessageKey.channelManagementDeleting),
                      subtitle: t(
                        PlatformMessageKey.channelManagementDeleteInProgress,
                      ),
                    ),
                  if (canDelete)
                    AppListRow(
                      key: const ValueKey('channel-details-delete'),
                      icon: LucideIcons.trash2,
                      title: t(PlatformMessageKey.channelManagementDelete),
                      titleColor: context.colors.error,
                      onTap: lifecycleBusy.value
                          ? null
                          : () => _confirmAndRun(
                              context,
                              title: t(
                                PlatformMessageKey.channelManagementDeleteTitle,
                              ),
                              body:
                                  '${t(PlatformMessageKey.channelManagementDeleteDescription, {'name': resolvedChannel.name})}\n\n${t(PlatformMessageKey.channelManagementDeleteDetail)}',
                              confirmLabel: t(
                                PlatformMessageKey.channelManagementDelete,
                              ),
                              cancelLabel: t(PlatformMessageKey.buzzCancel),
                              action: () => runLifecycle(
                                () =>
                                    actions().deleteChannel(resolvedChannel.id),
                                closeWhenRecorded: true,
                              ),
                            ),
                    ),
                ],
              ],
            ),
        ],
      ),
    );
  }
}

Future<void> _confirmAndRun(
  BuildContext context, {
  required String title,
  required String body,
  required String confirmLabel,
  required String cancelLabel,
  required Future<void> Function() action,
}) async {
  final confirmed = await showBuzzDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(cancelLabel),
        ),
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  if (confirmed == true && context.mounted) await action();
}

class _ChannelDetailsHero extends StatelessWidget {
  const _ChannelDetailsHero({required this.channel, required this.nameKey});

  final Channel channel;
  final GlobalKey nameKey;

  @override
  Widget build(BuildContext context) {
    final description = channel.description.trim();
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        _channelDetailsSectionPadding,
      ),
      child: Column(
        children: [
          Container(
            key: const ValueKey('channel-details-avatar'),
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: context.colors.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(
              channel.isPrivate ? LucideIcons.lock : LucideIcons.hash,
              size: 32,
              color: context.colors.onPrimaryContainer,
            ),
          ),
          const SizedBox(height: Grid.xxs),
          KeyedSubtree(
            key: const ValueKey('channel-details-name'),
            child: Text(
              channel.name,
              key: nameKey,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: context.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          if (description.isNotEmpty) ...[
            const SizedBox(height: Grid.half),
            Text(
              description,
              key: const ValueKey('channel-details-description'),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: context.textTheme.bodyMedium?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ChannelMemberPreviewRow extends StatelessWidget {
  const _ChannelMemberPreviewRow({
    super.key,
    required this.member,
    required this.isSelf,
    required this.isAdmin,
    required this.onMemberTap,
    required this.avatarUrl,
  });

  final WorkspaceMemberView member;
  final bool isSelf;
  final bool isAdmin;
  final void Function(BuildContext context, String pubkey) onMemberTap;
  final String? avatarUrl;

  @override
  Widget build(BuildContext context) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final label = isSelf
        ? platformText(PlatformMessageKey.channelMembersYou, locale: locale)
        : member.displayName;
    final initial = label.isEmpty ? '?' : label.characters.first.toUpperCase();
    final roleLabel = platformText(
      isAdmin
          ? PlatformMessageKey.channelMembersRoleAdmin
          : PlatformMessageKey.channelMembersRoleMember,
      locale: locale,
    );
    final titleStyle = context.textTheme.bodyLarge;
    final roleStyle = context.textTheme.bodySmall?.copyWith(
      color: context.colors.onSurfaceVariant,
    );
    final pubkey = member.pubkeys.isEmpty ? null : member.pubkeys.first;

    return AppListRowRaw(
      leading: AvatarImage(
        imageUrl: avatarUrl,
        radius: 20,
        backgroundColor: context.colors.primaryContainer,
        fallback: Text(initial),
      ),
      title: Text.rich(
        TextSpan(
          style: titleStyle,
          children: [
            TextSpan(text: label),
            TextSpan(text: ' · $roleLabel', style: roleStyle),
          ],
        ),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: pubkey == null ? null : const _ChannelDetailsChevron(),
      onTap: pubkey == null ? null : () => onMemberTap(context, pubkey),
      verticalPadding: Grid.xxs,
    );
  }
}

class _ChannelDetailsChevron extends StatelessWidget {
  const _ChannelDetailsChevron();

  @override
  Widget build(BuildContext context) => Icon(
    LucideIcons.chevronRight,
    size: 18,
    color: context.colors.onSurfaceVariant,
  );
}
