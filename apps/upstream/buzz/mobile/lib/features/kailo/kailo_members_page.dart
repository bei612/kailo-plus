import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/contracts/contracts.dart';
import '../../shared/kailo/kailo_platform_text.dart';
import '../../shared/kailo/kailo_views.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'kailo_async_view.dart';

/// 本人能进的 Workspace；点进去看成员。
class KailoWorkspacesPage extends ConsumerWidget {
  const KailoWorkspacesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          kailoText(KailoMessageKey.platformTabMembers, locale: locale),
        ),
      ),
      body: KailoAsyncView(
        value: ref.watch(kailoWorkspacesProvider),
        onRetry: () => ref.invalidate(kailoWorkspacesProvider),
        builder: (context, workspaces) => workspaces.isEmpty
            ? Center(
                child: Text(
                  kailoText(
                    KailoMessageKey.platformNoWorkspace,
                    locale: locale,
                  ),
                ),
              )
            : ListView(
                children: [
                  AppListCard(
                    label: kailoText(
                      KailoMessageKey.platformWorkspaces,
                      locale: locale,
                    ),
                    children: [
                      for (final workspace in workspaces)
                        AppListRow(
                          key: ValueKey('kailo-workspace-${workspace.id}'),
                          title: workspace.name,
                          subtitle: workspace.slug,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => KailoMembersPage(
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
class KailoMembersPage extends ConsumerWidget {
  const KailoMembersPage({
    super.key,
    required this.workspaceId,
    required this.title,
  });

  final String workspaceId;
  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final provider = kailoWorkspaceMembersProvider(workspaceId);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: KailoAsyncView(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        builder: (context, members) => ListView(
          children: [
            AppListCard(
              label: kailoText(
                kailoPluralOne(members.length, locale: locale)
                    ? KailoMessageKey.platformMembersCountOne
                    : KailoMessageKey.platformMembersCountOther,
                locale: locale,
                variables: {'count': members.length},
              ),
              children: [
                for (final member in members)
                  AppListRow(
                    key: ValueKey('kailo-member-${member.principalId}'),
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
  final state = kailoWorkspaceMembershipStateText(member.state, locale: locale);
  final keys = member.pubkeys.length;
  final count = kailoText(
    kailoPluralOne(keys, locale: locale)
        ? KailoMessageKey.platformMembersKeyCountOne
        : KailoMessageKey.platformMembersKeyCountOther,
    locale: locale,
    variables: {'count': keys},
  );
  return '$state · $count';
}
