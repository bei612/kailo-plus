import 'dart:convert';

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

/// REQ-21：原 Grant/Scope 只读消费者。不存在授予、撤销或执行入口。
class PlatformAgentDelegationsPage extends HookConsumerWidget {
  const PlatformAgentDelegationsPage({
    super.key,
    required this.workspaceId,
    required this.resourceId,
    required this.resourceVersion,
  });

  final String workspaceId;
  final String resourceId;
  final int resourceVersion;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    String text(PlatformMessageKey key) => platformText(key, locale: locale);
    final showTargets = useState(false);
    final offsets = useState<List<int>>([0]);
    final pageIndex = useState(0);
    final query = (
      workspaceId: workspaceId,
      resourceId: resourceId,
      resourceVersion: resourceVersion,
      offset: offsets.value[pageIndex.value],
    );
    final grantsProvider = platformAgentDelegationsProvider(query);
    final targetsProvider = platformAgentDelegationTargetsProvider(query);
    // 只订阅当前显式打开的目录；离开或切换后原 autoDispose 页释放。
    final Widget directory;
    if (showTargets.value) {
      directory = PlatformAsyncView(
        value: ref.watch(targetsProvider),
        onRetry: () => ref.invalidate(targetsProvider),
        builder: (context, page) => ListView(
          children: [
            Padding(
              padding: const EdgeInsets.all(Grid.gutter),
              child: Text(text(PlatformMessageKey.agentsDelegationReadOnly)),
            ),
            if (page.scopes.isEmpty)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(text(PlatformMessageKey.agentsDelegationNoTarget)),
              )
            else
              for (final scope in page.scopes)
                AppListCard(
                  key: ValueKey('platform-delegation-target-${jsonEncode(scope.toJson())}'),
                  children: _scopeRows(
                    DelegationScopeParameters.fromJson(scope.toJson()), locale,
                  ),
                ),
            _pagination(
              pageIndex.value, page.nextOffset, locale,
              () => pageIndex.value--,
              () {
                offsets.value = [
                  ...offsets.value.take(pageIndex.value + 1), page.nextOffset!,
                ];
                pageIndex.value++;
              },
            ),
          ],
        ),
      );
    } else {
      directory = PlatformAsyncView(
        value: ref.watch(grantsProvider),
        onRetry: () => ref.invalidate(grantsProvider),
        builder: (context, page) => ListView(
          children: [
            Padding(
              padding: const EdgeInsets.all(Grid.gutter),
              child: Text(text(PlatformMessageKey.agentsDelegationReadOnly)),
            ),
            if (page.grants.isEmpty)
              Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Text(text(PlatformMessageKey.agentsDelegationNone)),
              )
            else
              for (final grant in page.grants)
                AppListCard(
                  key: ValueKey('platform-delegation-${grant.delegationId}'),
                  label: grant.delegationId,
                  children: [
                    AppListRow(
                      title: text(PlatformMessageKey.platformState),
                      subtitle: _grantState(grant.toJson()['state'], locale),
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsDelegationVersion),
                      subtitle: '${grant.delegationVersion}',
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsDelegationGrantor),
                      subtitle: grant.grantorPrincipalId,
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsDelegationValidFrom),
                      subtitle: grant.parameters.validFrom.toUtc().toIso8601String(),
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsDelegationExpiresAt),
                      subtitle: grant.parameters.expiresAt.toUtc().toIso8601String(),
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsDelegationUses),
                      subtitle: '${grant.uses}',
                    ),
                    AppListRow(
                      title: text(PlatformMessageKey.agentsDelegationMaxUses),
                      subtitle: grant.parameters.maxUses?.toString() ??
                          text(PlatformMessageKey.agentsDelegationNoMaximumUses),
                    ),
                    for (final scope in grant.parameters.scopes)
                      ..._scopeRows(
                        DelegationScopeParameters.fromJson(scope.toJson()), locale,
                      ),
                  ],
                ),
            _pagination(
              pageIndex.value, page.nextOffset, locale,
              () => pageIndex.value--,
              () {
                offsets.value = [
                  ...offsets.value.take(pageIndex.value + 1), page.nextOffset!,
                ];
                pageIndex.value++;
              },
            ),
          ],
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(text(
          showTargets.value
              ? PlatformMessageKey.agentsDelegationTargetsReadOnly
              : PlatformMessageKey.agentsDelegationTitle,
        )),
        actions: [
          IconButton(
            tooltip: text(PlatformMessageKey.platformRefresh),
            onPressed: () => ref.invalidate(
              showTargets.value ? targetsProvider : grantsProvider,
            ),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(Grid.gutter),
            child: Text(
              '${text(PlatformMessageKey.platformWorkspace)}: $workspaceId\n'
              '${text(PlatformMessageKey.agentsInstallationId)}: $resourceId\n'
              '${text(PlatformMessageKey.agentsResourceVersion)}: $resourceVersion',
            ),
          ),
          OutlinedButton(
            key: const ValueKey('platform-delegation-directory-toggle'),
            onPressed: () {
              offsets.value = [0];
              pageIndex.value = 0;
              showTargets.value = !showTargets.value;
            },
            child: Text(text(
              showTargets.value
                  ? PlatformMessageKey.agentsDelegationTitle
                  : PlatformMessageKey.agentsDelegationTargetsReadOnly,
            )),
          ),
          Expanded(child: directory),
        ],
      ),
    );
  }
}

Widget _pagination(
  int pageIndex, int? nextOffset, String locale,
  VoidCallback previous, VoidCallback next,
) => Padding(
  padding: const EdgeInsets.all(Grid.gutter),
  child: Wrap(
    spacing: Grid.xs,
    children: [
      if (pageIndex > 0)
        OutlinedButton(
          key: const ValueKey('platform-delegations-previous'),
          onPressed: previous,
          child: Text(platformText(PlatformMessageKey.rolesPrevious, locale: locale)),
        ),
      if (nextOffset != null)
        OutlinedButton(
          key: const ValueKey('platform-delegations-next'),
          onPressed: next,
          child: Text(platformText(PlatformMessageKey.rolesNext, locale: locale)),
        ),
    ],
  ),
);

List<Widget> _scopeRows(DelegationScopeParameters scope, String locale) {
  String text(PlatformMessageKey key) => platformText(key, locale: locale);
  final exposure = switch (scope.toJson()['resultExposureMode']) {
    'CONSUME_ONLY' => PlatformMessageKey.agentsDelegationExposureConsumeOnly,
    'READ' => PlatformMessageKey.agentsDelegationExposureRead,
    'EXPORT' => PlatformMessageKey.agentsDelegationExposureExport,
    _ => PlatformMessageKey.nativeStatusOutcomeUnknown,
  };
  return [
    AppListRow(
      title: text(PlatformMessageKey.agentsDelegationScopes),
      subtitle: '${scope.actionKey}@${scope.actionVersion}',
    ),
    AppListRow(
      title: text(PlatformMessageKey.agentsDelegationTarget),
      subtitle: '${scope.targetType} · ${scope.targetId ?? scope.createWorkspaceId}',
    ),
    if (scope.toolResourceId != null)
      AppListRow(
        title: text(PlatformMessageKey.agentsDelegationTool),
        subtitle: scope.toolResourceId,
      ),
    AppListRow(
      title: text(PlatformMessageKey.agentsDelegationExposure),
      subtitle: text(exposure),
    ),
    AppListRow(
      title: text(PlatformMessageKey.agentsDelegationOutputSchemaHash),
      subtitle: scope.outputSchemaHash,
    ),
    AppListRow(
      title: text(PlatformMessageKey.agentsDelegationRedaction),
      subtitle: scope.redactionPolicy,
    ),
  ];
}

String _grantState(Object? state, String locale) {
  final key = switch (state) {
    'ACTIVE' => PlatformMessageKey.agentsDelegationStateActive,
    'REVOKING' => PlatformMessageKey.agentsDelegationStateRevoking,
    'REVOKED' => PlatformMessageKey.agentsDelegationStateRevoked,
    'EXPIRED' => PlatformMessageKey.agentsDelegationStateExpired,
    _ => PlatformMessageKey.nativeStatusOutcomeUnknown,
  };
  return platformText(key, locale: locale);
}
