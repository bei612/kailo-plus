/// 管理平面的只读视图（`REQ-21`：Mobile 以受权只读视图交付管理面）。
///
/// 数据一律来自 BFF `/api/v1/`，类型一律取自契约绑定；本端不重新判定任何权限，
/// BFF 拒绝什么就显示它按契约给出的 reason code。
library;

import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../auth/auth.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import '../profile/user_cache_provider.dart';
import '../profile/user_profile.dart';
import 'platform_api.dart';
import 'platform_config.dart';
import 'platform_device.dart';

/// 管理面视图失败时不自动重试：BFF 的拒绝是确定结论，重试不会改变它；不可达时
/// 由用户在界面上点「重试」。自动重试只会在后台反复敲 BFF。
Duration? _noRetry(int retryCount, Object error) => null;

Future<List<T>> _fetchList<T>(
  Ref ref,
  String path,
  T Function(Map<String, dynamic>) fromJson,
) async {
  final config = ref.watch(platformConfigProvider);
  if (config == null) throw const PlatformNotSignedIn();
  final response = await ref
      .read(nativeSessionProvider)
      .send(config, PlatformMethod.get, path);
  if (response.status != 200) throw PlatformApiError(response);
  return [
    for (final item in response.body! as List<dynamic>)
      fromJson(item as Map<String, dynamic>),
  ];
}

/// 本人当前的 PlatformSession 与显示名。
final platformSessionViewProvider = FutureProvider<PlatformSessionView>((
  ref,
) async {
  // 换了协作连接（重新登录、换设备密钥）就重新取
  ref.watch(authProvider.select((a) => a.value?.community?.id));
  final config = ref.watch(platformConfigProvider);
  if (config == null) throw const PlatformNotSignedIn();
  final response = await ref
      .read(nativeSessionProvider)
      .send(config, PlatformMethod.get, '/api/v1/session');
  if (response.status != 200) throw PlatformApiError(response);
  return PlatformSessionView.fromJson(response.body! as Map<String, dynamic>);
}, retry: _noRetry);

/// 本人能进的 Workspace。
final platformWorkspacesProvider = FutureProvider<List<WorkspaceView>>(
  (ref) => _fetchList(ref, '/api/v1/workspaces', WorkspaceView.fromJson),
  retry: _noRetry,
);

/// 某个 Workspace 的成员，按人聚合。Workspace id 同时是它的 Channel id。
final platformWorkspaceMembersProvider =
    FutureProvider.family<List<WorkspaceMemberView>, String>(
      (ref, workspaceId) => _fetchList(
        ref,
        '/api/v1/workspaces/$workspaceId/members',
        WorkspaceMemberView.fromJson,
      ),
      retry: _noRetry,
    );

/// 本人的审计记录。
final platformOwnAuditProvider = FutureProvider<List<OwnAuditEntry>>(
  (ref) => _fetchList(ref, '/api/v1/audit', OwnAuditEntry.fromJson),
  retry: _noRetry,
);

/// 取一项。别人的与不存在的是同一个回答（BFF 回 TARGET_NOT_FOUND）。
Future<T> _fetchOne<T>(
  Ref ref,
  String path,
  T Function(Map<String, dynamic>) fromJson,
) async {
  final config = ref.watch(platformConfigProvider);
  if (config == null) throw const PlatformNotSignedIn();
  final response = await ref
      .read(nativeSessionProvider)
      .send(config, PlatformMethod.get, path);
  if (response.status != 200) throw PlatformApiError(response);
  return fromJson(response.body! as Map<String, dynamic>);
}

/// DD-24/25、17 §8：Tenant 目录，空授权页只代表本页；不请求 Workspace 权限。
final platformAgentDefinitionsProvider = FutureProvider.autoDispose
    .family<AgentDefinitionPage, int>((ref, offset) async {
      if (offset < 0) throw const FormatException('Definition page offset');
      final params = Uri(queryParameters: {'offset': '$offset'}).query;
      final page = await _fetchOne(
        ref,
        '/api/v1/agent-definitions?$params',
        AgentDefinitionPage.fromJson,
      );
      if (page.nextOffset != null && page.nextOffset! <= offset) {
        throw const FormatException('Definition page cursor');
      }
      final ids = <String>{};
      for (final item in page.definitions) {
        final row = AgentDefinitionView.fromJson(item.toJson());
        _validateDefinition(row);
        if (!ids.add(row.resourceId)) {
          throw const FormatException('Definition duplicate');
        }
      }
      return page;
    }, retry: _noRetry);

/// Definition read 独立于目录 discover；不把 403/UNKNOWN 变为空记录。
final platformAgentDefinitionProvider = FutureProvider.autoDispose
    .family<AgentDefinitionView, String>((ref, resourceId) async {
      final row = await _fetchOne(
        ref,
        '/api/v1/agent-definitions/${Uri.encodeComponent(resourceId)}',
        AgentDefinitionView.fromJson,
      );
      _validateDefinition(row);
      if (row.resourceId != resourceId) {
        throw const FormatException('Definition identity');
      }
      return row;
    }, retry: _noRetry);

// 与共享 TS validDefinition 同一消费边界；Tenant、owner 投影和 read 仍由 BFF 查证。
void _validateDefinition(AgentDefinitionView row) {
  if (row.resourceId.isEmpty ||
      row.ownerPrincipalId.isEmpty ||
      row.resourceVersion <= 0 ||
      row.resourceState != ResourceState.ACTIVE ||
      row.status != 'ACTIVE' ||
      row.currentPublishedVersionAssetId?.isEmpty == true) {
    throw const FormatException('Definition record');
  }
}

/// 只读已发布指针的 exact Asset；Asset read 不从父 Definition read 推导。
final platformAgentPublishedVersionProvider = FutureProvider.autoDispose
    .family<AgentVersionView, ({String resourceId, String assetId})>((
      ref,
      query,
    ) async {
      final row = await _fetchOne(
        ref,
        '/api/v1/agent-versions/${Uri.encodeComponent(query.assetId)}',
        AgentVersionView.fromJson,
      );
      if (row.assetId != query.assetId ||
          row.agentResourceId != query.resourceId ||
          row.state != AgentVersionState.PUBLISHED ||
          row.ordinal <= 0 ||
          row.assetVersion <= 0 ||
          row.ownerPrincipalId.isEmpty ||
          !RegExp(r'^[0-9a-f]{64}$').hasMatch(row.configHash) ||
          row.content.runtimeProfileKey.isEmpty ||
          row.content.modelRouteResourceId.isEmpty) {
        throw const FormatException('Published version record');
      }
      return row;
    }, retry: _noRetry);

/// 17 §8：BFF 逐项 fresh Asset read 后的历史；不把空受权页解释成不存在版本。
final platformAgentVersionsProvider = FutureProvider.autoDispose
    .family<
      AgentVersionPage,
      ({String resourceId, int resourceVersion, int offset})
    >((ref, query) async {
      if (query.resourceId.isEmpty ||
          query.resourceVersion <= 0 ||
          query.offset < 0) {
        throw const FormatException('Version directory scope');
      }
      final params = Uri(queryParameters: {'offset': '${query.offset}'}).query;
      final page = await _fetchOne(
        ref,
        '/api/v1/agent-definitions/${Uri.encodeComponent(query.resourceId)}/versions?$params',
        AgentVersionPage.fromJson,
      );
      if (page.agentResourceId != query.resourceId ||
          page.resourceVersion != query.resourceVersion ||
          (page.nextOffset != null && page.nextOffset! <= query.offset)) {
        throw const FormatException(
          'Version directory identity/version/cursor',
        );
      }
      final assets = <String>{};
      final ordinals = <int>{};
      for (final item in page.versions) {
        final row = AgentVersionView.fromJson(item.toJson());
        if (row.agentResourceId != query.resourceId ||
            row.assetId.isEmpty ||
            row.ownerPrincipalId.isEmpty ||
            row.assetVersion <= 0 ||
            row.ordinal <= 0 ||
            !assets.add(row.assetId) ||
            !ordinals.add(row.ordinal) ||
            !RegExp(r'^[0-9a-f]{64}$').hasMatch(row.configHash) ||
            row.content.runtimeProfileKey.isEmpty ||
            row.content.modelRouteResourceId.isEmpty ||
            (row.state != AgentVersionState.DRAFT &&
                (row.canUpdate == true || row.canPublish == true))) {
          throw const FormatException('Version directory record');
        }
      }
      return page;
    }, retry: _noRetry);

/// DD-25/50、17 §8：按选定 Workspace 分页读取，不能据空授权页断言全域为空。
final platformAgentInstallationsProvider = FutureProvider.autoDispose
    .family<AgentInstallationPage, ({String workspaceId, int offset})>((
      ref,
      query,
    ) async {
      final params = Uri(
        queryParameters: {
          'workspaceId': query.workspaceId,
          'offset': '${query.offset}',
        },
      ).query;
      final page = await _fetchOne(
        ref,
        '/api/v1/agent-installations?$params',
        AgentInstallationPage.fromJson,
      );
      final next = page.nextOffset;
      if (query.offset < 0 || (next != null && next <= query.offset)) {
        throw const FormatException('Installation page cursor');
      }
      final ids = <String>{};
      for (final item in page.installations) {
        // 生成器的页内 element 与 root view 各自有绑定；复用生成解码，不手写 DTO。
        final row = AgentInstallationView.fromJson(item.toJson());
        _validateInstallation(row, workspaceId: query.workspaceId);
        if (!ids.add(row.resourceId)) {
          throw const FormatException('Installation page duplicate');
        }
      }
      return page;
    }, retry: _noRetry);

/// 精确 ID + Workspace fence；不解引用 Version 正文，也不调用 runtime/reconcile。
final platformAgentInstallationProvider = FutureProvider.autoDispose
    .family<AgentInstallationView, ({String workspaceId, String resourceId})>((
      ref,
      query,
    ) async {
      final row = await _fetchOne(
        ref,
        '/api/v1/agent-installations/${Uri.encodeComponent(query.resourceId)}',
        AgentInstallationView.fromJson,
      );
      _validateInstallation(row, workspaceId: query.workspaceId);
      if (row.resourceId != query.resourceId) {
        throw const FormatException('Installation detail identity');
      }
      return row;
    }, retry: _noRetry);

// 只验证跨字段的持久事实，权限仍由每次 BFF fresh Check 决定。
void _validateInstallation(
  AgentInstallationView row, {
  required String workspaceId,
}) {
  if (row.workspaceId != workspaceId ||
      row.resourceVersion <= 0 ||
      [
        row.resourceId,
        row.workspaceId,
        row.agentResourceId,
        row.pinnedVersionAssetId,
        row.agentPrincipalId,
        row.ownerPrincipalId,
      ].any((id) => id.isEmpty)) {
    throw const FormatException('Installation scope');
  }
  final projection = row.projection;
  if (projection != null &&
      (projection.generation <= 0 ||
          projection.agentVersionAssetId != row.pinnedVersionAssetId ||
          projection.runtimeProfileKey.isEmpty ||
          !RegExp(r'^[0-9a-f]{64}$').hasMatch(projection.configHash))) {
    throw const FormatException('Installation projection');
  }
  final generation = row.activeProjectionGeneration;
  if (generation != null &&
      (generation <= 0 || projection?.generation != generation)) {
    throw const FormatException('Installation generation');
  }
  if (row.channelBinding?.triggers.isEmpty == true) {
    throw const FormatException('Installation triggers');
  }
  if (row.toJson()['state'] == 'ACTIVE' &&
      (generation == null ||
          row.resourceState != ResourceState.ACTIVE ||
          projection?.toJson()['state'] != 'ACTIVE')) {
    throw const FormatException('Installation active record');
  }
}

/// 19 §5/7、REQ-21：只在 Memory 页面打开后枚举原生 head，不取正文。
final platformAgentMemoryEntriesProvider = FutureProvider.autoDispose
    .family<AgentMemoryEntryPage, ({String workspaceId, String resourceId})>((
      ref,
      query,
    ) async {
      final page = await _fetchOne(
        ref,
        '/api/v1/agent-installations/${Uri.encodeComponent(query.resourceId)}/memory/entries',
        AgentMemoryEntryPage.fromJson,
      );
      if (page.installationResourceId != query.resourceId ||
          page.workspaceId != query.workspaceId ||
          page.operationId.isEmpty) {
        throw const FormatException('Memory listing scope');
      }
      final slugs = <String>{};
      final heads = <String>{};
      for (final entry in page.entries) {
        _validateColdMemorySlug(entry.slug);
        _validateMemoryHead(entry.eventId, entry.createdAt);
        if (!slugs.add(entry.slug) || !heads.add(entry.eventId)) {
          throw const FormatException('Memory duplicate head');
        }
      }
      return page;
    }, retry: _noRetry);

/// 正文仅在显式打开时 GET；每次打开有独立临时实例，关闭即失去订阅并销毁。
/// 不 keepAlive、不写用户 cache/磁盘，不复用上次打开的明文。
final platformAgentMemoryReadProvider = FutureProvider.autoDispose
    .family<
      AgentMemoryReadView,
      ({
        String workspaceId,
        String resourceId,
        String slug,
        Object readInstance,
      })
    >((ref, query) async {
      final String path;
      if (query.slug == 'core') {
        path =
            '/api/v1/agent-installations/${Uri.encodeComponent(query.resourceId)}/memory/core';
      } else {
        _validateColdMemorySlug(query.slug);
        final params = Uri(queryParameters: {'slug': query.slug}).query;
        path =
            '/api/v1/agent-installations/${Uri.encodeComponent(query.resourceId)}/memory/entry?$params';
      }
      final row = await _fetchOne(ref, path, AgentMemoryReadView.fromJson);
      if (row.installationResourceId != query.resourceId ||
          row.workspaceId != query.workspaceId ||
          row.slug != query.slug ||
          row.operationId.isEmpty) {
        throw const FormatException('Memory read scope');
      }
      final hasHead = row.eventId != null || row.createdAt != null;
      if (hasHead) {
        if (row.eventId == null || row.createdAt == null) {
          throw const FormatException('Memory incomplete head');
        }
        _validateMemoryHead(row.eventId!, row.createdAt!);
      }
      switch (row.state) {
        case AgentMemoryReadViewState.FOUND:
          if (!hasHead ||
              row.content == null ||
              row.contentBytes != utf8.encode(row.content!).length) {
            throw const FormatException('Memory content evidence');
          }
        case AgentMemoryReadViewState.ABSENT:
          if (row.content != null || row.contentBytes != null) {
            throw const FormatException('Memory absent content');
          }
        case AgentMemoryReadViewState.UNREADABLE:
          if (hasHead || row.content != null || row.contentBytes != null) {
            throw const FormatException('Memory unreadable content');
          }
      }
      return row;
    }, retry: _noRetry);

// Buzz@779af8886caae1317b4de962082429867ab61503 engram.rs::validate_slug。
// 原协议语法/255 bytes，不是客户端创建的目录或新限额。
void _validateColdMemorySlug(String slug) {
  if (utf8.encode(slug).length > 255 ||
      RegExp(
            r'^mem/[a-z0-9][a-z0-9_-]{0,63}(/[a-z0-9][a-z0-9_-]{0,63})*$',
          ).stringMatch(slug) !=
          slug) {
    throw const FormatException('Memory slug');
  }
}

void _validateMemoryHead(String eventId, int createdAt) {
  if (eventId.length != 64 ||
      !RegExp(r'^[0-9a-f]{64}$').hasMatch(eventId) ||
      createdAt < 0) {
    throw const FormatException('Memory head');
  }
}

/// 17 §6/8、REQ-21：只读安装来源，不从 canCreate 生成 Mobile 写入口。
final platformAgentInstallationCandidatesProvider = FutureProvider.autoDispose
    .family<AgentInstallationCandidatePage, ({String workspaceId, int offset})>(
      (ref, query) async {
        if (query.workspaceId.isEmpty || query.offset < 0) {
          throw const FormatException('Installation candidate scope');
        }
        final params = Uri(
          queryParameters: {
            'workspaceId': query.workspaceId,
            'offset': '${query.offset}',
          },
        ).query;
        final page = await _fetchOne(
          ref,
          '/api/v1/agent-installation-candidates?$params',
          AgentInstallationCandidatePage.fromJson,
        );
        _validateAutomationCursor(query.offset, page.nextOffset);
        if (page.workspaceId != query.workspaceId) {
          throw const FormatException('Installation candidate workspace');
        }
        final assets = <String>{};
        for (final row in page.candidates) {
          if (row.agentResourceId.isEmpty ||
              row.agentVersionAssetId.isEmpty ||
              row.displayName.trim().isEmpty ||
              row.resourceVersion <= 0 ||
              row.assetVersion <= 0 ||
              row.ordinal <= 0 ||
              !assets.add(row.agentVersionAssetId)) {
            throw const FormatException('Installation candidate record');
          }
        }
        return page;
      },
      retry: _noRetry,
    );

/// 03 §6/17 §8：锁定打开的 Installation 版本，不拼接旧 pin 与新授权页。
final platformAgentDelegationsProvider = FutureProvider.autoDispose
    .family<
      AgentDelegationPage,
      ({String workspaceId, String resourceId, int resourceVersion, int offset})
    >((ref, query) async {
      final page = await _fetchOne(
        ref,
        '/api/v1/agent-installations/${Uri.encodeComponent(query.resourceId)}/delegations?offset=${query.offset}',
        AgentDelegationPage.fromJson,
      );
      _validateAutomationCursor(query.offset, page.nextOffset);
      if (query.workspaceId.isEmpty ||
          query.resourceId.isEmpty ||
          query.resourceVersion <= 0 ||
          page.workspaceId != query.workspaceId ||
          page.installationResourceId != query.resourceId ||
          page.resourceVersion != query.resourceVersion) {
        throw const FormatException('Delegation page scope/version');
      }
      final ids = <String>{};
      for (final row in page.grants) {
        final parameters = row.parameters;
        if (row.delegationId.isEmpty ||
            row.grantorPrincipalId.isEmpty ||
            row.delegationVersion <= 0 ||
            row.uses < 0 ||
            !ids.add(row.delegationId) ||
            !parameters.validFrom.isUtc ||
            !parameters.expiresAt.isUtc ||
            !parameters.expiresAt.isAfter(parameters.validFrom) ||
            (parameters.maxUses != null && parameters.maxUses! <= 0) ||
            parameters.scopes.isEmpty ||
            !const {
              'ACTIVE',
              'REVOKING',
              'REVOKED',
              'EXPIRED',
            }.contains(row.toJson()['state'])) {
          throw const FormatException('Delegation record');
        }
        for (final scope in parameters.scopes) {
          _validateDelegationScope(
            DelegationScopeParameters.fromJson(scope.toJson()),
          );
        }
      }
      return page;
    }, retry: _noRetry);

/// 显式打开才 GET 当前受权 Scope；目录不等于已有 Grant 或执行许可。
final platformAgentDelegationTargetsProvider = FutureProvider.autoDispose
    .family<
      AgentDelegationTargetPage,
      ({String workspaceId, String resourceId, int resourceVersion, int offset})
    >((ref, query) async {
      final page = await _fetchOne(
        ref,
        '/api/v1/agent-installations/${Uri.encodeComponent(query.resourceId)}/delegation-targets?offset=${query.offset}',
        AgentDelegationTargetPage.fromJson,
      );
      _validateAutomationCursor(query.offset, page.nextOffset);
      if (query.workspaceId.isEmpty ||
          query.resourceId.isEmpty ||
          query.resourceVersion <= 0 ||
          page.workspaceId != query.workspaceId ||
          page.installationResourceId != query.resourceId ||
          page.resourceVersion != query.resourceVersion) {
        throw const FormatException('Delegation target scope/version');
      }
      final scopes = <String>{};
      for (final item in page.scopes) {
        final scope = DelegationScopeParameters.fromJson(item.toJson());
        _validateDelegationScope(scope);
        if (!scopes.add(jsonEncode(scope.toJson()))) {
          throw const FormatException('Delegation duplicate scope');
        }
      }
      return page;
    }, retry: _noRetry);

void _validateDelegationScope(DelegationScopeParameters scope) {
  if (scope.actionKey.isEmpty ||
      scope.actionVersion <= 0 ||
      scope.targetType.isEmpty ||
      scope.redactionPolicy.isEmpty ||
      !RegExp(r'^[0-9a-f]{64}$').hasMatch(scope.outputSchemaHash) ||
      (scope.targetId == null) == (scope.createWorkspaceId == null) ||
      scope.targetId?.isEmpty == true ||
      scope.createWorkspaceId?.isEmpty == true ||
      scope.toolResourceId?.isEmpty == true ||
      !const {
        'CONSUME_ONLY',
        'READ',
        'EXPORT',
      }.contains(scope.toJson()['resultExposureMode'])) {
    throw const FormatException('Delegation scope evidence');
  }
}

/// REQ-21/DD-107：只读已准入 Workspace 的 Automation，不消费写入许可。
final platformAutomationsProvider = FutureProvider.autoDispose
    .family<AutomationPage, ({String workspaceId, int offset})>((
      ref,
      query,
    ) async {
      final params = Uri(
        queryParameters: {
          'workspaceId': query.workspaceId,
          'offset': '${query.offset}',
        },
      ).query;
      final page = await _fetchOne(
        ref,
        '/api/v1/automations?$params',
        AutomationPage.fromJson,
      );
      _validateAutomationCursor(query.offset, page.nextOffset);
      final ids = <String>{};
      for (final item in page.automations) {
        final row = AutomationView.fromJson(item.toJson());
        _validateAutomation(row, query.workspaceId);
        if (!ids.add(row.resourceId)) {
          throw const FormatException('Automation duplicate');
        }
      }
      return page;
    }, retry: _noRetry);

final platformAutomationProvider = FutureProvider.autoDispose
    .family<
      AutomationDetailView,
      ({
        String workspaceId,
        String resourceId,
        int versionOffset,
        int delegationOffset,
      })
    >((ref, query) async {
      final params = Uri(
        queryParameters: {
          'versionOffset': '${query.versionOffset}',
          'delegationOffset': '${query.delegationOffset}',
        },
      ).query;
      final detail = await _fetchOne(
        ref,
        '/api/v1/automations/${Uri.encodeComponent(query.resourceId)}?$params',
        AutomationDetailView.fromJson,
      );
      final row = AutomationView.fromJson(detail.automation.toJson());
      _validateAutomation(row, query.workspaceId);
      if (row.resourceId != query.resourceId) {
        throw const FormatException('Automation identity');
      }
      _validateAutomationCursor(query.versionOffset, detail.nextVersionOffset);
      _validateAutomationCursor(
        query.delegationOffset,
        detail.nextDelegationOffset,
      );
      final versions = <String>{};
      for (final version in detail.versions) {
        final content = version.content;
        final trigger = content.trigger;
        final spec = trigger.scheduleSpec;
        final validTrigger = switch (trigger.kind) {
          AutomationTriggerKind.MENTION =>
            content.resultTarget == AutomationResultTarget.TRIGGER_THREAD &&
                trigger.mentionPrincipalId?.isNotEmpty == true &&
                spec == null,
          AutomationTriggerKind.CHANNEL_MESSAGE =>
            content.resultTarget == AutomationResultTarget.TRIGGER_THREAD &&
                trigger.mentionPrincipalId == null &&
                spec == null,
          AutomationTriggerKind.SCHEDULE =>
            content.resultTarget == AutomationResultTarget.CHANNEL &&
                trigger.mentionPrincipalId == null &&
                trigger.textPrefix == null &&
                spec != null &&
                spec.everySeconds > 0 &&
                spec.offsetSeconds >= 0 &&
                spec.offsetSeconds < spec.everySeconds &&
                spec.catchupWindowSeconds >= 10,
        };
        if (!versions.add(version.assetId) ||
            version.assetId.isEmpty ||
            version.automationResourceId != row.resourceId ||
            version.assetVersion <= 0 ||
            version.ordinal <= 0 ||
            version.ownerPrincipalId.isEmpty ||
            !RegExp(r'^[0-9a-f]{64}$').hasMatch(version.configHash) ||
            content.action.template.trim().isEmpty ||
            !validTrigger ||
            trigger.textPrefix?.isEmpty == true) {
          throw const FormatException('Automation version');
        }
        if (version.assetId == row.pinnedVersionAssetId &&
            version.state != AgentVersionState.PUBLISHED) {
          throw const FormatException('Automation pinned version');
        }
      }
      final grants = <String>{};
      for (final grant in detail.delegations) {
        if (!grants.add(grant.delegationId) ||
            grant.delegationId.isEmpty ||
            grant.delegationVersion <= 0 ||
            grant.ownerPrincipalId != row.ownerPrincipalId ||
            grant.executorInstallationResourceId !=
                row.executorInstallationResourceId ||
            DateTime.tryParse(grant.expiresAt) == null) {
          throw const FormatException('Automation delegation');
        }
      }
      return detail;
    }, retry: _noRetry);

void _validateAutomationCursor(int offset, int? next) {
  if (offset < 0 || (next != null && next <= offset)) {
    throw const FormatException('Automation page cursor');
  }
}

// 跨字段一致性不是授权替代；每次 GET 仍由 BFF 核对 scope/owner/native projection。
void _validateAutomation(AutomationView row, String workspaceId) {
  if (row.workspaceId != workspaceId ||
      row.resourceVersion <= 0 ||
      row.resourceState != ResourceState.ACTIVE ||
      [
        row.resourceId,
        row.workspaceId,
        row.ownerPrincipalId,
        row.executorInstallationResourceId,
      ].any((id) => id.isEmpty) ||
      row.pinnedVersionAssetId?.isEmpty == true ||
      row.delegationId?.isEmpty == true ||
      (row.state == AutomationState.ENABLED &&
          (row.pinnedVersionAssetId == null || row.delegationId == null))) {
    throw const FormatException('Automation scope');
  }
}

/// 本人发起的受治理动作，新的在前（`.design/06` §9）。Mobile 只读：取消、撤回与
/// 审批决定都在 Web/Desktop 上（apps/02 §4）。
final platformTasksProvider = FutureProvider<List<TaskView>>(
  (ref) => _fetchList(ref, '/api/v1/tasks', TaskView.fromJson),
  retry: _noRetry,
);

final platformTaskProvider = FutureProvider.family<TaskView, String>(
  (ref, actionExecutionId) => _fetchOne(
    ref,
    '/api/v1/tasks/${Uri.encodeComponent(actionExecutionId)}',
    TaskView.fromJson,
  ),
  retry: _noRetry,
);

/// 待我审批：未决、我尚未决定、我此刻能满足某个选择器。
final platformPendingApprovalsProvider = FutureProvider<List<ApprovalView>>(
  (ref) => _fetchList(ref, '/api/v1/approvals', ApprovalView.fromJson),
  retry: _noRetry,
);

final platformApprovalProvider = FutureProvider.family<ApprovalView, String>(
  (ref, workflowId) => _fetchOne(
    ref,
    '/api/v1/approvals/${Uri.encodeComponent(workflowId)}',
    ApprovalView.fromJson,
  ),
  retry: _noRetry,
);

/// 本人登记且未撤销的设备。
final platformDevicesProvider = FutureProvider<List<ClientKeyView>>(
  (ref) => _fetchList(ref, platformRegisterPath, ClientKeyView.fromJson),
  retry: _noRetry,
);

/// 把 Workspace 成员名单里的显示名交给作者显示（`DD-77`：一人多把公钥，按
/// pubkey 归到同一个人）。原生设备的公钥没有 kind:0 资料，作者名只能从这里来。
/// Channel 页面 watch 它即可；取不到名单时作者照旧显示公钥。
final platformAuthorNamesProvider = FutureProvider.family<void, String>((
  ref,
  workspaceId,
) async {
  final members = await ref.watch(
    platformWorkspaceMembersProvider(workspaceId).future,
  );
  final cache = ref.read(userCacheProvider.notifier);
  for (final member in members) {
    for (final pubkey in member.pubkeys) {
      cache.put(
        UserProfile(
          pubkey: pubkey.toLowerCase(),
          displayName: member.displayName,
        ),
      );
    }
  }
}, retry: _noRetry);
