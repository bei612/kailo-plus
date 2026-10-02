import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_agent_installations_page.dart';
import 'platform_async_view.dart';

/// REQ-21、17 §8：在既有管理面选择已准入 Workspace，只读安装事实。
class PlatformAgentInstallationWorkspacesPage extends ConsumerWidget {
  const PlatformAgentInstallationWorkspacesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final value = ref.watch(platformWorkspacesProvider);
    final checked = value.whenData((rows) {
      if (rows.any((w) => w.id.isEmpty)
          || rows.map((w) => w.id).toSet().length != rows.length) {
        throw const FormatException('Workspace selection');
      }
      return rows;
    });
    return Scaffold(
      appBar: AppBar(
        title: Text(platformText(PlatformMessageKey.platformTabAgents, locale: locale)),
        actions: [
          IconButton(
            tooltip: platformText(PlatformMessageKey.platformRefresh, locale: locale),
            onPressed: () => ref.invalidate(platformWorkspacesProvider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: PlatformAsyncView(
        value: checked,
        onRetry: () => ref.invalidate(platformWorkspacesProvider),
        builder: (context, workspaces) => ListView(
          children: [
            Padding(
              padding: const EdgeInsets.all(Grid.gutter),
              child: Text(platformText(PlatformMessageKey.agentsInstallationReadOnly, locale: locale)),
            ),
            if (workspaces.isEmpty)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(platformText(PlatformMessageKey.agentsInstallationNoWorkspace, locale: locale)),
              )
            else
              AppListCard(
                label: platformText(PlatformMessageKey.platformWorkspaces, locale: locale),
                children: [
                  for (final workspace in workspaces)
                    AppListRow(
                      key: ValueKey('platform-installation-workspace-${workspace.id}'),
                      title: workspace.name,
                      subtitle: workspace.slug,
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => PlatformAgentInstallationsPage(
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
