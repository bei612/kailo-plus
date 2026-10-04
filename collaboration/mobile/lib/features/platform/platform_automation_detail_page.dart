import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';

import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_automations_page.dart';
import 'platform_async_view.dart';

class PlatformAutomationDetailPage extends HookConsumerWidget {
  const PlatformAutomationDetailPage({
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
    Widget field(PlatformMessageKey key, String? value) => AppListRow(
      title: text(key),
      subtitle: value ?? text(PlatformMessageKey.agentsInstallationNotRecorded),
    );
    final versionOffsets = useState<List<int>>([0]);
    final versionIndex = useState(0);
    final grantOffsets = useState<List<int>>([0]);
    final grantIndex = useState(0);
    final provider = platformAutomationProvider((
      workspaceId: workspaceId,
      resourceId: resourceId,
      versionOffset: versionOffsets.value[versionIndex.value],
      delegationOffset: grantOffsets.value[grantIndex.value],
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
        builder: (context, detail) {
          final row = detail.automation;
          return ListView(
            key: const ValueKey('platform-automation-detail'),
            children: [
              AppListCard(
                children: [
                  field(
                    PlatformMessageKey.agentsInstallationId,
                    row.resourceId,
                  ),
                  field(
                    PlatformMessageKey.platformState,
                    platformAutomationStateText(row.state, locale: locale),
                  ),
                  field(
                    PlatformMessageKey.agentsResourceVersion,
                    '${row.resourceVersion}',
                  ),
                  field(PlatformMessageKey.platformWorkspace, row.workspaceId),
                  field(PlatformMessageKey.agentsOwner, row.ownerPrincipalId),
                  field(
                    PlatformMessageKey.agentsAutomationExecutor,
                    row.executorInstallationResourceId,
                  ),
                  field(
                    PlatformMessageKey.agentsAutomationPinned,
                    row.pinnedVersionAssetId,
                  ),
                  field(
                    PlatformMessageKey.agentsAutomationGrant,
                    row.delegationId,
                  ),
                ],
              ),
              AppListCard(
                label: text(PlatformMessageKey.agentsInstallationVersion),
                children: [
                  if (detail.versions.isEmpty)
                    AppListRow(
                      title: text(PlatformMessageKey.agentsAutomationNoVersion),
                    ),
                  for (final version in detail.versions) ...[
                    AppListRow(
                      title: version.assetId,
                      subtitle:
                          '${text(switch (version.state) {
                            AgentVersionState.DRAFT => PlatformMessageKey.agentsAutomationStateDraft,
                            AgentVersionState.PUBLISHED => PlatformMessageKey.agentsVersionPublished,
                            AgentVersionState.RETIRED => PlatformMessageKey.agentsAutomationVersionRetired,
                          })} · ${version.ordinal}',
                    ),
                    field(
                      PlatformMessageKey.agentsResourceVersion,
                      '${version.assetVersion}',
                    ),
                    field(
                      PlatformMessageKey.agentsOwner,
                      version.ownerPrincipalId,
                    ),
                    field(
                      PlatformMessageKey.agentsVersionHash,
                      version.configHash,
                    ),
                    field(
                      PlatformMessageKey.agentsAutomationTrigger,
                      text(switch (version.content.trigger.kind) {
                        AutomationTriggerKind.MENTION =>
                          PlatformMessageKey.agentsInstallationTriggerMention,
                        AutomationTriggerKind.CHANNEL_MESSAGE =>
                          PlatformMessageKey.agentsAutomationChannelMessage,
                        AutomationTriggerKind.SCHEDULE =>
                          PlatformMessageKey.agentsAutomationSchedule,
                      }),
                    ),
                    if (version.content.trigger.mentionPrincipalId != null)
                      field(
                        PlatformMessageKey.agentsInstallationPrincipal,
                        version.content.trigger.mentionPrincipalId,
                      ),
                    if (version.content.trigger.textPrefix != null)
                      field(
                        PlatformMessageKey.agentsAutomationPrefix,
                        version.content.trigger.textPrefix,
                      ),
                    if (version.content.trigger.scheduleSpec
                        case final spec?) ...[
                      field(
                        PlatformMessageKey.agentsAutomationEverySeconds,
                        '${spec.everySeconds}',
                      ),
                      field(
                        PlatformMessageKey.agentsAutomationOffsetSeconds,
                        '${spec.offsetSeconds}',
                      ),
                      field(
                        PlatformMessageKey.agentsAutomationCatchupWindowSeconds,
                        '${spec.catchupWindowSeconds}',
                      ),
                    ],
                    field(
                      PlatformMessageKey.agentsAutomationTemplate,
                      version.content.action.template,
                    ),
                    field(
                      PlatformMessageKey.agentsAutomationResultTarget,
                      text(switch (version.content.resultTarget) {
                        AutomationResultTarget.TRIGGER_THREAD =>
                          PlatformMessageKey.agentsAutomationThread,
                        AutomationResultTarget.CHANNEL =>
                          PlatformMessageKey.agentsAutomationChannel,
                      }),
                    ),
                  ],
                ],
              ),
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Wrap(
                  spacing: Grid.xs,
                  children: [
                    if (versionIndex.value > 0)
                      OutlinedButton(
                        onPressed: () => versionIndex.value--,
                        child: Text(text(PlatformMessageKey.rolesPrevious)),
                      ),
                    if (detail.nextVersionOffset != null)
                      OutlinedButton(
                        onPressed: () {
                          versionOffsets.value = [
                            ...versionOffsets.value.take(
                              versionIndex.value + 1,
                            ),
                            detail.nextVersionOffset!,
                          ];
                          versionIndex.value++;
                        },
                        child: Text(text(PlatformMessageKey.rolesNext)),
                      ),
                  ],
                ),
              ),
              AppListCard(
                label: text(PlatformMessageKey.agentsAutomationGrant),
                children: [
                  if (detail.delegations.isEmpty)
                    AppListRow(
                      title: text(PlatformMessageKey.agentsAutomationNoGrant),
                    ),
                  for (final grant in detail.delegations) ...[
                    AppListRow(
                      title: grant.delegationId,
                      subtitle:
                          '${grant.delegationVersion} · ${grant.expiresAt}',
                    ),
                    field(
                      PlatformMessageKey.agentsOwner,
                      grant.ownerPrincipalId,
                    ),
                    field(
                      PlatformMessageKey.agentsAutomationExecutor,
                      grant.executorInstallationResourceId,
                    ),
                  ],
                ],
              ),
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Wrap(
                  spacing: Grid.xs,
                  children: [
                    if (grantIndex.value > 0)
                      OutlinedButton(
                        onPressed: () => grantIndex.value--,
                        child: Text(text(PlatformMessageKey.rolesPrevious)),
                      ),
                    if (detail.nextDelegationOffset != null)
                      OutlinedButton(
                        onPressed: () {
                          grantOffsets.value = [
                            ...grantOffsets.value.take(grantIndex.value + 1),
                            detail.nextDelegationOffset!,
                          ];
                          grantIndex.value++;
                        },
                        child: Text(text(PlatformMessageKey.rolesNext)),
                      ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
