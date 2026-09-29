import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_async_view.dart';

/// 本人能进的 Workspace；点进去看成员。
class PlatformWorkspacesPage extends ConsumerWidget {
  const PlatformWorkspacesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          platformText(PlatformMessageKey.platformTabMembers, locale: locale),
        ),
      ),
      body: PlatformAsyncView(
        value: ref.watch(platformWorkspacesProvider),
        onRetry: () => ref.invalidate(platformWorkspacesProvider),
        builder: (context, workspaces) => workspaces.isEmpty
            ? Center(
                child: Text(
                  platformText(
                    PlatformMessageKey.platformNoWorkspace,
                    locale: locale,
                  ),
                ),
              )
            : ListView(
                children: [
                  AppListCard(
                    label: platformText(
                      PlatformMessageKey.platformWorkspaces,
                      locale: locale,
                    ),
                    children: [
                      for (final workspace in workspaces)
                        AppListRow(
                          key: ValueKey('platform-workspace-${workspace.id}'),
                          title: workspace.name,
                          subtitle: workspace.slug,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => PlatformMembersPage(
                                workspaceId: workspace.id,
                                title: workspace.name,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
      ),
    );
  }
}

/// 一个 Workspace 的成员，按人聚合（`DD-77`）。Channel 的成员视图也是它：
/// Workspace id 就是 Channel id。
class PlatformMembersPage extends ConsumerWidget {
  const PlatformMembersPage({
    super.key,
    required this.workspaceId,
    required this.title,
  });

  final String workspaceId;
  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final provider = platformWorkspaceMembersProvider(workspaceId);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: PlatformAsyncView(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        builder: (context, members) => ListView(
          children: [
            AppListCard(
              label: platformText(
                platformPluralOne(members.length, locale: locale)
                    ? PlatformMessageKey.platformMembersCountOne
                    : PlatformMessageKey.platformMembersCountOther,
                locale: locale,
                variables: {'count': members.length},
              ),
              children: [
                for (final member in members)
                  AppListRow(
                    key: ValueKey('platform-member-${member.principalId}'),
                    title: member.displayName,
                    subtitle: _memberSubtitle(member, locale),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

String _memberSubtitle(WorkspaceMemberView member, String locale) {
  final state = platformWorkspaceMembershipStateText(
    member.state,
    locale: locale,
  );
  final keys = member.pubkeys.length;
  final count = platformText(
    platformPluralOne(keys, locale: locale)
        ? PlatformMessageKey.platformMembersKeyCountOne
        : PlatformMessageKey.platformMembersKeyCountOther,
    locale: locale,
    variables: {'count': keys},
  );
  return '$state · $count';
}
