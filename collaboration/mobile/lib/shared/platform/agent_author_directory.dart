/// DD-147：成员可读的 Agent 作者目录（`GET /api/v1/workspaces/{id}/agent-authors`）。
///
/// 只列本 Workspace 有 ACTIVE ChannelAgentBinding 的 Agent：公钥、固定版本的显示名、owner
/// 与 owner 显示名，不授予任何权限。Mobile 的成员列表用它恢复原版「Agents」分区；
/// 拒绝与不可达按 BFF 的 reason code 呈现，不在本端合成。
library;

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'platform_api.dart';
import 'platform_config.dart';

/// Workspace id 同时是它的 Channel id。
final platformAgentAuthorsProvider = FutureProvider.autoDispose
    .family<List<AgentAuthorView>, String>((ref, workspaceId) async {
      final config = ref.watch(platformConfigProvider);
      if (config == null) throw const PlatformNotSignedIn();
      final response = await ref
          .read(nativeSessionProvider)
          .send(
            config,
            PlatformMethod.get,
            '/api/v1/workspaces/${Uri.encodeComponent(workspaceId)}/agent-authors',
          );
      if (response.status != 200) throw PlatformApiError(response);
      return AgentAuthorDirectory.fromJson(
        response.body! as Map<String, dynamic>,
      ).agents;
    }, retry: (_, _) => null);
