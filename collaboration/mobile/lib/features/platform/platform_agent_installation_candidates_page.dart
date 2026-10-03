import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_async_view.dart';

/// 17 §6/8：只读受权的 exact PUBLISHED 来源；无默认版本或安装操作。
class PlatformAgentInstallationCandidatesPage extends HookConsumerWidget {
  const PlatformAgentInstallationCandidatesPage({
    super.key,
    required this.workspaceId,
  });

  final String workspaceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    final offsets = useState<List<int>>([0]);
    final pageIndex = useState(0);
    final provider = platformAgentInstallationCandidatesProvider((
      workspaceId: workspaceId,
      offset: offsets.value[pageIndex.value],
    ));
    return Scaffold(
      appBar: AppBar(
        title: Text(text(PlatformMessageKey.agentsInstallationCandidates)),
        actions: [
          IconButton(
            tooltip: text(PlatformMessageKey.platformRefresh),
            onPressed: () => ref.invalidate(provider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: PlatformAsyncView(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        builder: (context, page) => ListView(
          children: [
            Padding(
              padding: const EdgeInsets.all(Grid.gutter),
              child: Text(
                text(PlatformMessageKey.agentsInstallationCandidatesReadOnly),
              ),
            ),
            AppListCard(
              children: [
                AppListRow(
                  title: text(PlatformMessageKey.platformWorkspace),
                  subtitle: page.workspaceId,
                ),
              ],
            ),
            if (page.candidates.isEmpty)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(text(PlatformMessageKey.agentsInstallationNoPublished)),
              )
            else
              for (final row in page.candidates)
                AppListCard(
                  key: ValueKey('platform-installation-source-${row.agentVersionAssetId}'),
                  label: row.displayName,
                  children: [
                    AppListRow(
                      title: text(PlatformMessageKey.agentsVersionPublished),
                      subtitle: '${text(PlatformMessageKey.agentsVersionOrdinal)}: ${row.ordinal}',
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsInstallationDefinition),
                      subtitle: row.agentResourceId,
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsResourceVersion),
                      subtitle: '${row.resourceVersion}',
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsInstallationVersion),
                      subtitle: row.agentVersionAssetId,
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsVersionAssetVersion),
                      subtitle: '${row.assetVersion}',
                    ),
                  ],
                ),
            Padding(
              padding: const EdgeInsets.all(Grid.gutter),
              child: Wrap(
                spacing: Grid.xs,
                children: [
                  if (pageIndex.value > 0)
                    OutlinedButton(
                      key: const ValueKey('platform-installation-sources-previous'),
                      onPressed: () => pageIndex.value--,
                      child: Text(text(PlatformMessageKey.rolesPrevious)),
                    ),
                  if (page.nextOffset != null)
                    OutlinedButton(
                      key: const ValueKey('platform-installation-sources-next'),
                      onPressed: () {
                        offsets.value = [
                          ...offsets.value.take(pageIndex.value + 1),
                          page.nextOffset!,
                        ];
                        pageIndex.value++;
                      },
                      child: Text(text(PlatformMessageKey.rolesNext)),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
