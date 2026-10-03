import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_agent_memory_page.dart';
import 'platform_async_view.dart';

/// 精确 pin、身份、频道与持久投影摘要，不读取 prompt/secret/隔离目录或执行状态。
class PlatformAgentInstallationDetailPage extends ConsumerWidget {
  const PlatformAgentInstallationDetailPage({
    super.key,
    required this.workspaceId,
    required this.resourceId,
  });

  final String workspaceId;
  final String resourceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final provider = platformAgentInstallationProvider((
      workspaceId: workspaceId,
      resourceId: resourceId,
    ));
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    Widget field(PlatformMessageKey key, String? value) => AppListRow(
      title: text(key),
      subtitle: value ?? text(PlatformMessageKey.agentsInstallationNotRecorded),
    );
    return Scaffold(
      appBar: AppBar(
        title: Text(text(PlatformMessageKey.agentsInstallationId)),
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
        builder: (context, row) {
          final facts = row.toJson();
          final projection = row.projection;
          final channel = row.channelBinding;
          final channelFacts = channel?.toJson();
          return ListView(
            key: const ValueKey('platform-installation-detail'),
            children: [
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(
                  text(PlatformMessageKey.agentsInstallationReadOnly),
                ),
              ),
              AppListCard(
                children: [
                  field(
                    PlatformMessageKey.agentsInstallationId,
                    row.resourceId,
                  ),
                  field(
                    PlatformMessageKey.platformState,
                    platformInstallationStateText(row, locale: locale),
                  ),
                  field(
                    PlatformMessageKey.agentsResourceVersion,
                    '${row.resourceVersion}',
                  ),
                  AppListRow(
                    title: _status('resource', facts['resourceState'], locale),
                  ),
                  field(PlatformMessageKey.agentsOwner, row.ownerPrincipalId),
                  field(PlatformMessageKey.platformWorkspace, row.workspaceId),
                  field(
                    PlatformMessageKey.agentsInstallationDefinition,
                    row.agentResourceId,
                  ),
                  field(
                    PlatformMessageKey.agentsInstallationVersion,
                    row.pinnedVersionAssetId,
                  ),
                  field(
                    PlatformMessageKey.agentsInstallationPrincipal,
                    row.agentPrincipalId,
                  ),
                  AppListRow(
                    title: _status(
                      'principal',
                      facts['agentPrincipalState'],
                      locale,
                    ),
                  ),
                ],
              ),
              AppListCard(
                label: text(PlatformMessageKey.agentsInstallationChannel),
                children: [
                  if (channel != null) ...[
                    AppListRow(
                      title: _status(
                        'channel',
                        channelFacts?['status'],
                        locale,
                      ),
                    ),
                    field(
                      PlatformMessageKey.agentsInstallationChannel,
                      channel.channelId,
                    ),
                    field(
                      PlatformMessageKey.agentsInstallationTriggers,
                      (channelFacts?['triggers'] as List<dynamic>)
                          .map((value) => _status('trigger', value, locale))
                          .join(' · '),
                    ),
                  ] else
                    AppListRow(
                      title: text(
                        PlatformMessageKey.agentsInstallationNotRecorded,
                      ),
                    ),
                ],
              ),
              AppListCard(
                label: text(PlatformMessageKey.agentsInstallationProjection),
                children: [
                  field(
                    PlatformMessageKey.agentsInstallationActiveGeneration,
                    row.activeProjectionGeneration?.toString(),
                  ),
                  if (projection != null) ...[
                    AppListRow(
                      title: _status(
                        'projection',
                        projection.toJson()['state'],
                        locale,
                      ),
                    ),
                    field(
                      PlatformMessageKey.agentsInstallationGeneration,
                      '${projection.generation}',
                    ),
                    field(
                      PlatformMessageKey.agentsVersionRuntimeProfile,
                      projection.runtimeProfileKey,
                    ),
                    field(
                      PlatformMessageKey.agentsVersionHash,
                      projection.configHash,
                    ),
                  ] else
                    AppListRow(
                      title: text(
                        PlatformMessageKey.agentsInstallationNotRecorded,
                      ),
                    ),
                ],
              ),
              AppListCard(
                children: [
                  AppListRow(
                    key: const ValueKey('platform-installation-memory'),
                    title: text(PlatformMessageKey.agentsMemoryTitle),
                    subtitle: text(PlatformMessageKey.agentsMemoryReadOnly),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => PlatformAgentMemoryPage(
                          workspaceId: workspaceId,
                          resourceId: resourceId,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

/// 两个实际列表/详情消费者共用同源状态文案，不把记录 ACTIVE 映射成成功。
String platformInstallationStateText(
  AgentInstallationView row, {
  String? locale,
}) => _status('installation', row.toJson()['state'], locale);

String _status(String kind, Object? state, String? locale) {
  const labels = <String, PlatformMessageKey>{
    'installation:PROVISIONING':
        PlatformMessageKey.agentsInstallationStateProvisioning,
    'installation:ACTIVE': PlatformMessageKey.agentsInstallationStateActive,
    'installation:DRAINING': PlatformMessageKey.agentsInstallationStateDraining,
    'installation:DISABLED': PlatformMessageKey.agentsInstallationStateDisabled,
    'installation:ERROR': PlatformMessageKey.agentsInstallationStateError,
    'projection:PENDING':
        PlatformMessageKey.agentsInstallationProjectionPending,
    'projection:ACTIVE': PlatformMessageKey.agentsInstallationProjectionActive,
    'projection:ERROR': PlatformMessageKey.agentsInstallationProjectionError,
    'projection:REVOKED':
        PlatformMessageKey.agentsInstallationProjectionRevoked,
    'principal:ACTIVE': PlatformMessageKey.agentsInstallationPrincipalActive,
    'principal:DISABLED':
        PlatformMessageKey.agentsInstallationPrincipalDisabled,
    'channel:ACTIVE': PlatformMessageKey.agentsInstallationChannelActive,
    'channel:DISABLED': PlatformMessageKey.agentsInstallationChannelDisabled,
    'channel:ERROR': PlatformMessageKey.agentsInstallationChannelError,
    'trigger:MENTION': PlatformMessageKey.agentsInstallationTriggerMention,
    'trigger:MANUAL_ASSIGNMENT':
        PlatformMessageKey.agentsInstallationTriggerManual,
    'resource:PROVISIONING':
        PlatformMessageKey.agentsInstallationResourceProvisioning,
    'resource:ACTIVE': PlatformMessageKey.agentsInstallationResourceActive,
    'resource:UNKNOWN': PlatformMessageKey.agentsInstallationResourceUnknown,
    'resource:FAILED': PlatformMessageKey.agentsInstallationResourceFailed,
    'resource:RETAINED_READ_ONLY':
        PlatformMessageKey.agentsInstallationResourceRetained,
    'resource:DELETING': PlatformMessageKey.agentsInstallationResourceDeleting,
    'resource:DELETED': PlatformMessageKey.agentsInstallationResourceDeleted,
  };
  return platformText(
    labels['$kind:$state'] ?? PlatformMessageKey.nativeStatusOutcomeUnknown,
    locale: locale,
  );
}
