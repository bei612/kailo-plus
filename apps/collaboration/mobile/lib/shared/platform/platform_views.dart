/// 管理平面的只读视图（Kailo `REQ-21`：Mobile 以受权只读视图交付管理面）。
///
/// 数据一律来自 BFF `/api/v1/`，类型一律取自契约绑定；本端不重新判定任何权限，
/// BFF 拒绝什么就显示它按契约给出的 reason code。
library;

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
  final config = ref.watch(kailoConfigProvider);
  if (config == null) throw const KailoNotSignedIn();
  final response = await ref
      .read(kailoSessionProvider)
      .send(config, KailoMethod.get, path);
  if (response.status != 200) throw KailoApiError(response);
  return [
    for (final item in response.body! as List<dynamic>)
      fromJson(item as Map<String, dynamic>),
  ];
}

/// 本人当前的 PlatformSession 与显示名。
final kailoSessionViewProvider = FutureProvider<PlatformSessionView>((
  ref,
) async {
  // 换了协作连接（重新登录、换设备密钥）就重新取
  ref.watch(authProvider.select((a) => a.value?.community?.id));
  final config = ref.watch(kailoConfigProvider);
  if (config == null) throw const KailoNotSignedIn();
  final response = await ref
      .read(kailoSessionProvider)
      .send(config, KailoMethod.get, '/api/v1/session');
  if (response.status != 200) throw KailoApiError(response);
  return PlatformSessionView.fromJson(response.body! as Map<String, dynamic>);
}, retry: _noRetry);

/// 本人能进的 Workspace。
final kailoWorkspacesProvider = FutureProvider<List<WorkspaceView>>(
  (ref) => _fetchList(ref, '/api/v1/workspaces', WorkspaceView.fromJson),
  retry: _noRetry,
);

/// 某个 Workspace 的成员，按人聚合。Workspace id 同时是它的 Channel id。
final kailoWorkspaceMembersProvider =
    FutureProvider.family<List<WorkspaceMemberView>, String>(
      (ref, workspaceId) => _fetchList(
        ref,
        '/api/v1/workspaces/$workspaceId/members',
        WorkspaceMemberView.fromJson,
      ),
      retry: _noRetry,
    );

/// 本人的审计记录。
final kailoOwnAuditProvider = FutureProvider<List<OwnAuditEntry>>(
  (ref) => _fetchList(ref, '/api/v1/audit', OwnAuditEntry.fromJson),
  retry: _noRetry,
);

/// 取一项。别人的与不存在的是同一个回答（BFF 回 TARGET_NOT_FOUND）。
Future<T> _fetchOne<T>(
  Ref ref,
  String path,
  T Function(Map<String, dynamic>) fromJson,
) async {
  final config = ref.watch(kailoConfigProvider);
  if (config == null) throw const KailoNotSignedIn();
  final response = await ref
      .read(kailoSessionProvider)
      .send(config, KailoMethod.get, path);
  if (response.status != 200) throw KailoApiError(response);
  return fromJson(response.body! as Map<String, dynamic>);
}

/// 本人发起的受治理动作，新的在前（`.design/06` §9）。Mobile 只读：取消、撤回与
/// 审批决定都在 Web/Desktop 上（apps/02 §4）。
final kailoTasksProvider = FutureProvider<List<TaskView>>(
  (ref) => _fetchList(ref, '/api/v1/tasks', TaskView.fromJson),
  retry: _noRetry,
);

final kailoTaskProvider = FutureProvider.family<TaskView, String>(
  (ref, actionExecutionId) => _fetchOne(
    ref,
    '/api/v1/tasks/${Uri.encodeComponent(actionExecutionId)}',
    TaskView.fromJson,
  ),
  retry: _noRetry,
);

/// 待我审批：未决、我尚未决定、我此刻能满足某个选择器。
final kailoPendingApprovalsProvider = FutureProvider<List<ApprovalView>>(
  (ref) => _fetchList(ref, '/api/v1/approvals', ApprovalView.fromJson),
  retry: _noRetry,
);

final kailoApprovalProvider = FutureProvider.family<ApprovalView, String>(
  (ref, workflowId) => _fetchOne(
    ref,
    '/api/v1/approvals/${Uri.encodeComponent(workflowId)}',
    ApprovalView.fromJson,
  ),
  retry: _noRetry,
);

/// 本人登记且未撤销的设备。
final kailoDevicesProvider = FutureProvider<List<ClientKeyView>>(
  (ref) => _fetchList(ref, kailoRegisterPath, ClientKeyView.fromJson),
  retry: _noRetry,
);

/// 把 Workspace 成员名单里的显示名交给作者显示（`DD-77`：一人多把公钥，按
/// pubkey 归到同一个人）。原生设备的公钥没有 kind:0 资料，作者名只能从这里来。
/// Channel 页面 watch 它即可；取不到名单时作者照旧显示公钥。
final kailoAuthorNamesProvider = FutureProvider.family<void, String>((
  ref,
  workspaceId,
) async {
  final members = await ref.watch(
    kailoWorkspaceMembersProvider(workspaceId).future,
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
