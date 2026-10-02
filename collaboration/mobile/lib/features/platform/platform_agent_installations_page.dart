import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_agent_installation_detail_page.dart';
import 'platform_async_view.dart';

/// 有界授权扫描页。Mobile 的安装管理不生成写入或运行按钮。
class PlatformAgentInstallationsPage extends HookConsumerWidget {
  const PlatformAgentInstallationsPage({super.key, required this.workspaceId, required this.title});

  final String workspaceId;
  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final offsets = useState<List<int>>([0]);
    final pageIndex = useState(0);
    final provider = platformAgentInstallationsProvider((
      workspaceId: workspaceId,
      offset: offsets.value[pageIndex.value],
    ));
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            tooltip: platformText(PlatformMessageKey.platformRefresh, locale: locale),
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
              child: Text(platformText(PlatformMessageKey.agentsInstallationReadOnly, locale: locale)),
            ),
            if (page.installations.isEmpty)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(platformText(PlatformMessageKey.agentsInstallationNone, locale: locale)),
              )
            else
              AppListCard(
                label: platformText(PlatformMessageKey.agentsInstallationTitle, locale: locale),
                children: [
                  for (final item in page.installations)
                    AppListRow(
                      key: ValueKey('platform-installation-${item.resourceId}'),
                      title: item.resourceId,
                      subtitle: '${platformInstallationStateText(AgentInstallationView.fromJson(item.toJson()), locale: locale)}\n'
                          '${platformText(PlatformMessageKey.agentsInstallationVersion, locale: locale)}: ${item.pinnedVersionAssetId}\n'
                          '${platformText(PlatformMessageKey.agentsInstallationPrincipal, locale: locale)}: ${item.agentPrincipalId}',
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => PlatformAgentInstallationDetailPage(
                            workspaceId: workspaceId,
                            resourceId: item.resourceId,
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
                      key: const ValueKey('platform-installations-previous'),
                      onPressed: () => pageIndex.value--,
                      child: Text(platformText(PlatformMessageKey.rolesPrevious, locale: locale)),
                    ),
                  if (page.nextOffset != null)
                    OutlinedButton(
                      key: const ValueKey('platform-installations-next'),
                      onPressed: () {
                        offsets.value = [...offsets.value.take(pageIndex.value + 1), page.nextOffset!];
                        pageIndex.value++;
                      },
                      child: Text(platformText(PlatformMessageKey.rolesNext, locale: locale)),
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
