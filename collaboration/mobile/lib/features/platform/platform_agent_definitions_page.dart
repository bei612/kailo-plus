import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_agent_definition_detail_page.dart';
import 'platform_async_view.dart';

/// REQ-21、17 §8：只读 Tenant Agent 目录，不生成创建、发布或运行入口。
class PlatformAgentDefinitionsPage extends HookConsumerWidget {
  const PlatformAgentDefinitionsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    final offsets = useState<List<int>>([0]);
    final pageIndex = useState(0);
    final provider = platformAgentDefinitionsProvider(
      offsets.value[pageIndex.value],
    );
    return Scaffold(
      appBar: AppBar(
        title: Text(text(PlatformMessageKey.platformTabAgents)),
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
            if (page.definitions.isEmpty)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(text(PlatformMessageKey.agentsNone)),
              )
            else
              AppListCard(
                label: text(PlatformMessageKey.platformTabAgents),
                children: [
                  for (final row in page.definitions)
                    AppListRow(
                      key: ValueKey(
                        'platform-agent-definition-${row.resourceId}',
                      ),
                      title: row.displayName,
                      subtitle:
                          '${row.stableSlug}\n'
                          '${text(PlatformMessageKey.agentsOwner)}: ${row.ownerPrincipalId}\n'
                          '${text(PlatformMessageKey.agentsPublishedVersion)}: '
                          '${row.currentPublishedVersionAssetId ?? text(PlatformMessageKey.agentsNoPublishedVersion)}',
                      subtitleMaxLines: 4,
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => PlatformAgentDefinitionDetailPage(
                            resourceId: row.resourceId,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            Padding(
              padding: const EdgeInsets.all(Grid.gutter),
              child: Wrap(
                spacing: Grid.xs,
                runSpacing: Grid.xs,
                children: [
                  if (pageIndex.value > 0)
                    OutlinedButton(
                      key: const ValueKey(
                        'platform-agent-definitions-previous',
                      ),
                      onPressed: () => pageIndex.value--,
                      child: Text(text(PlatformMessageKey.rolesPrevious)),
                    ),
                  if (page.nextOffset != null)
                    OutlinedButton(
                      key: const ValueKey('platform-agent-definitions-next'),
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
