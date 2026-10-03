import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_async_view.dart';

/// Installation 的 BFF 只读 Memory 视图；明文只存在于当前显式打开的读实例。
class PlatformAgentMemoryPage extends HookConsumerWidget {
  const PlatformAgentMemoryPage({
    super.key,
    required this.workspaceId,
    required this.resourceId,
  });

  final String workspaceId;
  final String resourceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    final opened = useState<({String slug, Object readInstance})?>(null);
    final current = opened.value;
    final entriesProvider = platformAgentMemoryEntriesProvider((
      workspaceId: workspaceId,
      resourceId: resourceId,
    ));
    // 仅 head 元数据随页面保留；关闭正文不额外触发列表 GET。
    final entries = ref.watch(entriesProvider);
    // 本地临时实例只控制一次 GET 的寿命，不是协议身份或持久缓存键。
    void open(String slug) =>
        opened.value = (slug: slug, readInstance: Object());

    if (current != null) {
      final provider = platformAgentMemoryReadProvider((
        workspaceId: workspaceId,
        resourceId: resourceId,
        slug: current.slug,
        readInstance: current.readInstance,
      ));
      return Scaffold(
        appBar: AppBar(
          title: Text(
            text(
              current.slug == 'core'
                  ? PlatformMessageKey.agentsMemoryCore
                  : PlatformMessageKey.agentsMemoryReadEntry,
            ),
          ),
          leading: IconButton(
            key: const ValueKey('platform-memory-close'),
            tooltip: text(PlatformMessageKey.agentsMemoryClose),
            onPressed: () => opened.value = null,
            icon: const Icon(Icons.close),
          ),
        ),
        body: PlatformAsyncView(
          value: ref.watch(provider),
          onRetry: () => ref.invalidate(provider),
          builder: (context, row) => ListView(
            key: const ValueKey('platform-memory-read'),
            children: [
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(text(PlatformMessageKey.agentsMemoryReadOnly)),
              ),
              AppListCard(
                children: [
                  AppListRow(
                    title: text(PlatformMessageKey.agentsMemorySlug),
                    subtitle: row.slug,
                  ),
                  AppListRow(
                    key: const ValueKey('platform-memory-read-state'),
                    title: text(switch (row.state) {
                      AgentMemoryReadViewState.FOUND =>
                        PlatformMessageKey.agentsMemoryFound,
                      AgentMemoryReadViewState.ABSENT =>
                        PlatformMessageKey.agentsMemoryAbsent,
                      AgentMemoryReadViewState.UNREADABLE =>
                        PlatformMessageKey.agentsMemoryUnreadable,
                    }),
                  ),
                  if (row.eventId != null)
                    AppListRow(
                      title: text(PlatformMessageKey.agentsMemoryHead),
                      subtitle: '${row.eventId}\n${row.createdAt}',
                    ),
                  if (row.state == AgentMemoryReadViewState.ABSENT &&
                      row.eventId != null)
                    AppListRow(
                      title: text(PlatformMessageKey.agentsMemoryTombstone),
                    ),
                ],
              ),
              if (current.slug == 'core')
                Padding(
                  padding: const EdgeInsets.all(Grid.gutter),
                  child: Text(text(PlatformMessageKey.agentsMemoryNewSessions)),
                ),
              if (row.state == AgentMemoryReadViewState.FOUND)
                Padding(
                  padding: const EdgeInsets.all(Grid.gutter),
                  child: Text(
                    row.content!,
                    key: const ValueKey('platform-memory-content'),
                    style: context.textTheme.bodyMedium,
                  ),
                ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(text(PlatformMessageKey.agentsMemoryTitle)),
        actions: [
          IconButton(
            key: const ValueKey('platform-memory-refresh'),
            tooltip: text(PlatformMessageKey.platformRefresh),
            onPressed: () => ref.invalidate(entriesProvider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: PlatformAsyncView(
        value: entries,
        onRetry: () => ref.invalidate(entriesProvider),
        builder: (context, page) => ListView(
          key: const ValueKey('platform-memory-overview'),
          children: [
            Padding(
              padding: const EdgeInsets.all(Grid.gutter),
              child: Text(text(PlatformMessageKey.agentsMemoryReadOnly)),
            ),
            AppListCard(
              children: [
                AppListRow(
                  title: text(PlatformMessageKey.agentsInstallationId),
                  subtitle: resourceId,
                ),
                AppListRow(
                  title: text(PlatformMessageKey.platformWorkspace),
                  subtitle: workspaceId,
                ),
                AppListRow(
                  key: const ValueKey('platform-memory-open-core'),
                  title: text(PlatformMessageKey.agentsMemoryCore),
                  subtitle: text(PlatformMessageKey.agentsMemoryNewSessions),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open('core'),
                ),
              ],
            ),
            if (page.state != AgentMemoryEntryPageState.COMPLETE)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(
                  text(
                    page.state == AgentMemoryEntryPageState.BOUND_EXCEEDED
                        ? PlatformMessageKey.agentsMemoryBoundExceeded
                        : PlatformMessageKey.agentsMemoryUnknown,
                  ),
                  key: const ValueKey('platform-memory-list-state'),
                ),
              ),
            if (page.state == AgentMemoryEntryPageState.COMPLETE &&
                page.entries.isEmpty)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(text(PlatformMessageKey.agentsMemoryNone)),
              ),
            if (page.entries.isNotEmpty)
              AppListCard(
                label: text(PlatformMessageKey.agentsMemoryCold),
                children: [
                  for (final entry in page.entries)
                    AppListRow(
                      key: ValueKey('platform-memory-entry-${entry.slug}'),
                      title: entry.slug,
                      subtitle:
                          '${entry.eventId}\n${entry.createdAt}'
                          '${entry.tombstone ? '\n${text(PlatformMessageKey.agentsMemoryTombstone)}' : ''}',
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => open(entry.slug),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
