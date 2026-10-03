import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_async_view.dart';

/// REQ-21、17 §8：稳定 Definition 与 exact PUBLISHED Version 的独立受权读取。
class PlatformAgentDefinitionDetailPage extends ConsumerWidget {
  const PlatformAgentDefinitionDetailPage({
    super.key,
    required this.resourceId,
  });

  final String resourceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    Widget field(PlatformMessageKey key, String value) =>
        AppListRow(title: text(key), subtitle: value);
    final provider = platformAgentDefinitionProvider(resourceId);
    return Scaffold(
      appBar: AppBar(
        title: Text(text(PlatformMessageKey.agentsOpen)),
        actions: [
          IconButton(
            tooltip: text(PlatformMessageKey.platformRefresh),
            onPressed: () {
              final assetId = ref
                  .read(provider)
                  .asData
                  ?.value
                  .currentPublishedVersionAssetId;
              if (assetId != null) {
                ref.invalidate(
                  platformAgentPublishedVersionProvider((
                    resourceId: resourceId,
                    assetId: assetId,
                  )),
                );
              }
              ref.invalidate(provider);
            },
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: PlatformAsyncView(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        builder: (context, row) => ListView(
          key: const ValueKey('platform-agent-definition-detail'),
          children: [
            AppListCard(
              label: row.displayName,
              children: [
                field(PlatformMessageKey.agentsName, row.displayName),
                field(PlatformMessageKey.agentsSlug, row.stableSlug),
                field(PlatformMessageKey.agentsOwner, row.ownerPrincipalId),
                field(
                  PlatformMessageKey.agentsResourceVersion,
                  '${row.resourceVersion}',
                ),
                // Definition 的 ACTIVE 只表示此定义记录；不是 runtime/Invocation 成功。
                field(
                  PlatformMessageKey.platformState,
                  text(PlatformMessageKey.agentsDefinitionReady),
                ),
              ],
            ),
            if (row.currentPublishedVersionAssetId == null)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(text(PlatformMessageKey.agentsNoPublishedVersion)),
              )
            else
              Consumer(
                key: ValueKey(row.currentPublishedVersionAssetId),
                builder: (context, versionRef, _) {
                  final versionProvider =
                      platformAgentPublishedVersionProvider((
                        resourceId: row.resourceId,
                        assetId: row.currentPublishedVersionAssetId!,
                      ));
                  return PlatformAsyncView(
                    value: versionRef.watch(versionProvider),
                    onRetry: () => versionRef.invalidate(versionProvider),
                    builder: (context, version) => AppListCard(
                      key: const ValueKey('platform-agent-published-version'),
                      label: text(PlatformMessageKey.agentsPublishedVersion),
                      children: [
                        AppListRow(
                          title: text(
                            PlatformMessageKey.agentsVersionPublished,
                          ),
                        ),
                        field(
                          PlatformMessageKey.agentsPublishedVersion,
                          version.assetId,
                        ),
                        field(
                          PlatformMessageKey.agentsVersionOrdinal,
                          '${version.ordinal}',
                        ),
                        field(
                          PlatformMessageKey.agentsOwner,
                          version.ownerPrincipalId,
                        ),
                        field(
                          PlatformMessageKey.agentsVersionRuntimeProfile,
                          version.content.runtimeProfileKey,
                        ),
                        field(
                          PlatformMessageKey.agentsVersionModelRoute,
                          version.content.modelRouteResourceId,
                        ),
                        field(
                          PlatformMessageKey.agentsVersionHash,
                          version.configHash,
                        ),
                        Padding(
                          padding: const EdgeInsets.all(Grid.gutter),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                text(
                                  PlatformMessageKey.agentsVersionInstructions,
                                ),
                                style: context.textTheme.titleSmall,
                              ),
                              const SizedBox(height: Grid.xs),
                              SelectableText(
                                version.content.instructions,
                                key: const ValueKey(
                                  'platform-agent-version-instructions',
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}
