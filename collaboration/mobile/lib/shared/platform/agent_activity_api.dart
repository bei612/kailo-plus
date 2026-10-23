/// DD-125(6)、17 §8：Agent 工作中与活动转写的只读入口，沿用 client-kit 的同一 BFF 路由。
///
/// - `GET /api/v1/workspaces/{id}/agent-turns`：只对 Installation `audit` 持有人给出仍在运行
///   的回合；其他成员得到空列表，只靠 Agent 的 20002 输入中信号判断“工作中”。
/// - `GET /api/v1/agent-installations/{id}/transcript`：一个 AgentSession 的 Codex 条目（升序
///   分页，游标绑定范围），同样只对 `audit` 持有人开放，每次读取在 Core 记审计。
///
/// 两者都只是 Core 事实的投影：拒绝与不可达按 BFF 的 reason code 呈现，不在本端合成，也不轮询。
library;

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'platform_api.dart';
import 'platform_config.dart';

/// Workspace id 同时是它的 Channel id。
final platformAgentActiveTurnsProvider = FutureProvider.autoDispose
    .family<AgentActiveTurnPage, String>((ref, workspaceId) async {
      final config = ref.watch(platformConfigProvider);
      if (config == null) throw const PlatformNotSignedIn();
      final response = await ref
          .read(nativeSessionProvider)
          .send(
            config,
            PlatformMethod.get,
            '/api/v1/workspaces/${Uri.encodeComponent(workspaceId)}/agent-turns',
          );
      if (response.status != 200) throw PlatformApiError(response);
      final page = AgentActiveTurnPage.fromJson(
        response.body! as Map<String, dynamic>,
      );
      // A page for another Workspace is not evidence about this one.
      if (page.workspaceId != workspaceId) {
        return AgentActiveTurnPage(turns: const [], workspaceId: workspaceId);
      }
      return page;
    }, retry: (_, _) => null);

/// One audited transcript page of [turn]'s AgentSession, after [cursor].
typedef AgentTranscriptReader =
    Future<AgentTranscriptPage> Function(
      AgentActiveTurnView turn, {
      String? cursor,
    });

final agentTranscriptReaderProvider = Provider<AgentTranscriptReader>((ref) {
  return (turn, {cursor}) async {
    final config = ref.read(platformConfigProvider);
    if (config == null) throw const PlatformNotSignedIn();
    final query = Uri(
      queryParameters: {
        'rootEventId': turn.rootEventId,
        'projectionGeneration': '${turn.projectionGeneration}',
        'cursor': ?cursor,
      },
    ).query;
    final response = await ref
        .read(nativeSessionProvider)
        .send(
          config,
          PlatformMethod.get,
          '/api/v1/agent-installations/'
          '${Uri.encodeComponent(turn.installationId)}/transcript?$query',
        );
    if (response.status != 200) throw PlatformApiError(response);
    final page = AgentTranscriptPage.fromJson(
      response.body! as Map<String, dynamic>,
    );
    if (!transcriptPageBelongsTo(page, turn)) {
      throw StateError('transcript page outside the requested session');
    }
    return page;
  };
});

/// The cursor is scope-bound: a page for another session is refused, never merged.
bool transcriptPageBelongsTo(
  AgentTranscriptPage page,
  AgentActiveTurnView turn,
) =>
    page.installationId == turn.installationId &&
    page.rootEventId == turn.rootEventId &&
    page.projectionGeneration == turn.projectionGeneration;
