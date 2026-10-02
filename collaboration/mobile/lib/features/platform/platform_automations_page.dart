import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';

import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_automation_detail_page.dart';
import 'platform_async_view.dart';

/// Mobile 只展示 BFF 的当前受权记录，不生成 Automation 管理/运行动作。
class PlatformAutomationsPage extends HookConsumerWidget {
  const PlatformAutomationsPage({super.key, required this.workspaceId});

  final String workspaceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    final offsets = useState<List<int>>([0]);
    final index = useState(0);
    final provider = platformAutomationsProvider((
      workspaceId: workspaceId,
      offset: offsets.value[index.value],
    ));
    return Scaffold(
      appBar: AppBar(
        title: Text(text(PlatformMessageKey.agentsAutomationTitle)),
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
            if (page.automations.isEmpty)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(text(PlatformMessageKey.agentsAutomationNone)),
              )
            else
              AppListCard(
                children: [
                  for (final row in page.automations)
                    AppListRow(
                      key: ValueKey('platform-automation-${row.resourceId}'),
                      title: row.resourceId,
                      subtitle:
                          '${platformAutomationStateText(row.state, locale: locale)}\n'
                          '${text(PlatformMessageKey.agentsAutomationExecutor)}: ${row.executorInstallationResourceId}',
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => PlatformAutomationDetailPage(
                            workspaceId: workspaceId,
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
                children: [
                  if (index.value > 0)
                    OutlinedButton(
                      onPressed: () => index.value--,
                      child: Text(text(PlatformMessageKey.rolesPrevious)),
                    ),
                  if (page.nextOffset != null)
                    OutlinedButton(
                      onPressed: () {
                        offsets.value = [
                          ...offsets.value.take(index.value + 1),
                          page.nextOffset!,
                        ];
                        index.value++;
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

String platformAutomationStateText(
  AutomationState state, {
  String? locale,
}) => platformText(switch (state) {
  AutomationState.DRAFT => PlatformMessageKey.agentsAutomationStateDraft,
  AutomationState.ENABLED => PlatformMessageKey.agentsAutomationStateEnabled,
  AutomationState.PAUSED => PlatformMessageKey.agentsAutomationStatePaused,
  AutomationState.DISABLED => PlatformMessageKey.agentsAutomationStateDisabled,
}, locale: locale);
