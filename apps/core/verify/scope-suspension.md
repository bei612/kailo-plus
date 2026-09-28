# Workspace 暂停与恢复核验

对应 `.design/06` §7.3、`.design/03` §2（生命周期 Action 从 Tenant scope 指向 Workspace）、`.design/10` §5、`DD-46`、`DD-97`、`V-SCN-36`。Tenant 暂停不在本记录范围。

## 动作与准入

| 事实 | 实现 |
|---|---|
| 两个 ActionDefinition | `workspace.suspend`、`workspace.restore`（迁移 `20260928140000_workspace_suspension`）：`target_type=WORKSPACE`、`SESSION_TENANT`、`TENANT_ONLY`、tenant `manage`、`TEMPORAL`、`WORKSPACE_LIFECYCLE`、无审批。未登记取消与重跑控制定义，Workspace delete 不登记 |
| 执行 scope | ActionExecution 的 `workspace_id` 为空、`target_id` 为 Workspace ID：从 Tenant scope 发起，不借用被暂停的 Workspace scope。权限在所属 Tenant 上 fresh Check `manage` |
| 参数闭集 | 只接受 `workspaceId`；带任何其他参数以 `INVALID_PARAMETERS` 拒绝 |
| 起始状态 | 暂停接受同 Tenant 的 `ACTIVE` 或 `ERROR`，恢复只接受 `SUSPENDED`；其他状态 `TARGET_STATE_CONFLICT`，跨 Tenant 或不存在的 ID 同为 `TARGET_NOT_FOUND`。目录形状与语义不一致时 `CAPABILITY_BLOCKED` |
| 先关门再收敛 | 准入落定的同一事务内以条件更新置 `SUSPENDING`（或 `SUSPENDED→RESTORING`）并 version+1，影响行数不为 1 按 `TARGET_STATE_CONFLICT` 拒绝；预写的 workflow ID 用新 version |
| 派发 | `launch_scope` 以请求声明的段（`SUSPEND`/`RESTORE`）启动，并核对实体正停在该段的收敛中状态；两者不一致回 409，不按当前状态猜。Tenant 只接受建立链 |
| 派发中止 | 派发被确定拒绝记 `ABORTED` 时，同一事务把该 Workspace 从 `SUSPENDING`/`RESTORING` 置 `ERROR`（version+1）：不会再有 Workflow 把它带出收敛中状态 |

## 暂停期间 fail closed

- 本人可进入的 Workspace 列表、Workspace 准入（消息、成员、媒体、stream 建立与周期再准入）、用户状态可见性都要求 Workspace `ACTIVE`，因此 `SUSPENDING` 起即拒绝；已建立的 BFF stream 在下一次再准入时关闭。
- Governed Action 的评估对 `WORKSPACE_REQUIRED` 定义在 permission Check 之前核对执行 Workspace 属于该 Tenant 且 `ACTIVE`，覆盖成员增删、Workspace 角色与该 Workspace 内任务的取消/重跑控制；成员与角色语义的 target 解析本身也要求 `ACTIVE`。
- 原生端直连 Relay 的一侧由 Channel roster 清空与归档关闭（DD-97，见下节）。Resource、Asset、owner、SpiceDB relationship 与 binding 在暂停中都不改动；Channel 只 archive，不走 DELETE_GROUP。

## Workflow（`WORKSPACE_LIFECYCLE`）

- input 的 `scope.operation`：建立链不写该字段，JSON 与既有录制 history 逐字相同（单元测试 `provision_input_keeps_recorded_shape`）；Worker 以字段缺省走原建立链，建立路径命令序列未变。
- `SUSPEND`：RUNNING → `ConvergeWorkspaceChannelRoster(CLEAR)` → `ConvergeWorkspaceChannelArchive(archived=true)` → `TransitionScope(SUSPENDED)` → COMPLETED。
- `RESTORE`：RUNNING → `SpiceDB.Converge(workspace#tenant@tenant, Present)` 读回查证 → `ConvergeWorkspaceChannelArchive(archived=false)` → `ConvergeWorkspaceChannelRoster(REBUILD)` → `TransitionScope(ACTIVE)` → COMPLETED。
- 两个 service 路由都先核对 Workspace 停在调用方持有的版本与该段的收敛中状态（归档与 CLEAR 要求 `SUSPENDING`，解档与 REBUILD 要求 `RESTORING`），且 `WorkspaceBuzzBinding` 为 `ACTIVE`；任一不成立回 409（确定拒绝，不重试）。回读未达目标回 503（结果不明，Activity 重试）。
- 失败收尾：`begin`、任一收敛步骤或最终跃迁被确定拒绝时，Workflow 经 Core 把 Workspace 跃迁到 `ERROR` 并写 FAILED；该次 `ERROR` 跃迁本身被拒绝只随失败一并上报，不再重试跃迁。取消与 continue-as-new 不改写实体状态。`ERROR` 的 Workspace 可再次暂停收敛。
- 重跑控制未开放：`task_rerun::converging_state` 对这两个原动作不给收敛中状态，不会被当作建立链以 `PROVISIONING` 重跑。停留在收敛中状态的 Workspace 由对账作业计入 `kailo.entity.stranded`。

## Channel roster 清空与重建（DD-97）

`POST /service/v1/workspaces/channel-roster`，body `{workspaceId, workspaceVersion, mode}`：

- `CLEAR`：按 Relay 回读到的 kind 39002 roster 枚举全部非 CONTROL 成员，逐个以 9001 收敛到缺席（不按 Core 集合去删，Core 之外混进 roster 的钥匙同样移出），再回读确认只剩 CONTROL。
- `REBUILD`：期望集合取 `roster_reconcile::settled_channel_roster`，即 CONTROL 加该 Workspace 全部 ACTIVE WorkspaceMembership 对应 Principal（其 TenantMembership 也为 ACTIVE）的全部 ACTIVE Buzz 身份，与对账度量同一处定义。多余的 9001 移出、缺少的 9000 加入；仍在建立或撤权途中的钥匙（`roster_reconcile::unsettled_channel_roster`，同为对账度量的口径）两个方向都不动，由各自的投影 Workflow 收敛。收敛后按当前事实重算期望集合并与回读比对，一致才 200。
- AGENT 身份（ACTIVE AgentInstallation 且有 active ChannelAgentBinding）属于设计的期望集合；这些实体随 Stage 5 交付，届时并入 `REBUILD`。
- 每一次加入或移出由 bridge `converge` 执行：先读 roster，目标已成立即不发事件；发送后以回读为判据。归档与解档由 `converge_channel_archived` 以回读的 kind 39000 `["archived","true"]` 为判据，已是目标状态时不再发 9002。
- 集合运算由单元测试 `tenant_lifecycle::roster_tests` 覆盖（CLEAR 移出全部非 CONTROL、REBUILD 增删与收敛中钥匙不动、回读比对）。

## 暂停期间的设备与成员投影

- 原生设备公钥投入（`identity_projection` 的 register）：跳过所属 Workspace 为 `SUSPENDING` 或 `SUSPENDED` 的 Channel，由恢复时的重建补上；`RESTORING` 与 `ACTIVE` 照常投入（解档前 9000 被拒即按结果不明重试）。投入后的复核同样把 Workspace 进入暂停视为不再可投入，移出刚投入的钥匙。relay roster 照常投入。
- 原生设备公钥撤出（retire）：不按 Workspace 状态筛 Channel。暂停中的 Channel 在清空后已无该 pubkey，`converge(Absent)` 先读 roster 即成立、不发 9001，不会卡在已归档的 Channel 上；relay roster 照常移出，被撤设备不会因某个 Workspace 暂停而滞留在 relay 上。
- 成员投影（`membership_projection`）不改：暂停期间新增已被准入拒绝；在途的加入在已归档 Channel 上被拒即按结果不明重试，恢复后成功；撤出方向同样按缺席查证。它只作用于该 Workspace 的 Channel scope，不阻塞 relay roster 的收敛。
- roster 对账度量（`roster_reconcile`）：`SUSPENDING`/`SUSPENDED` Workspace 的 Channel 期望集合为只剩 CONTROL；`RESTORING`/`ACTIVE` 按成员事实。

## 管理入口

- `GET /api/v1/role-workspaces` 列出持有 workspace `manage` 的 `ACTIVE`、`SUSPENDING`、`SUSPENDED`、`RESTORING` Workspace，以及已有 `WorkspaceBuzzBinding` 的 `ERROR` Workspace（建立失败而无 binding 的 `ERROR` 不列），每项带 `state`。
- Core 以只读准入（目录开放、定义形状、tenant `manage` fresh Check）给出 `lifecycleActionKey`：`ACTIVE` 与 `ERROR` 给暂停，`SUSPENDED` 给恢复，收敛中不给。该判定失败（目录形状不符、依赖不可用）时记 warn，本页所有项都不给生命周期键，页面其余部分照常返回。提交时仍完整重新准入。
- Web/Desktop 共用的角色管理页显示本地化状态，仅在有动作键时渲染暂停或恢复按钮。受理回应按门禁与派发状态呈现：`ALLOWED`+`DISPATCHED` 显示已登记与操作号；`ABORTED` 显示原因与操作号并放下意图；其余（未派发、派发结果不明）显示结果不明与操作号，保留原幂等键只允许重查原请求。选中非 `ACTIVE` 的 Workspace 时，角色区显式标注当前作用域为整个组织。Mobile 不提供此写入口。

## 已运行的检查（2026-09-28）

| 检查 | 结果 |
|---|---|
| `SQLX_OFFLINE=true cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings` | 通过 |
| `SQLX_OFFLINE=true cargo test --manifest-path core/Cargo.toml` | 62 通过、0 失败、3 忽略；集成用例在无环境变量时跳过，含本能力的 `tests/workspace_suspension.rs` |
| Core 单元：`membership_lifecycle::tests`、`tenant_lifecycle::roster_tests`、`task_rerun::tests::identity_rerun_direction_is_fixed_by_original_action`、`capability_registry::tests` | 通过 |
| `go build ./... && go vet ./... && go test ./...`（worker） | 通过；`workflows/workspace_suspension_test.go` 覆盖暂停先清空 roster 再归档再跃迁、恢复先对账归属关系再解档再重建再跃迁、归档或重建被拒进入 ERROR、跃迁被拒只再试一次 ERROR、未知 operation 当场拒绝 |
| `pnpm -r typecheck`、`pnpm -r test` | 通过（platform 70 项） |

## 真实环境核验（2026-09-28，`--fresh` 后的本地拓扑）

以 `core/crates/kailo-core/tests/workspace_suspension.rs` 为脚本，经 `core/verify/run-integration.sh` 在新 Core、Worker 与迁移 `20260928140000_workspace_suspension` 上运行：全套退出 0（30 批），该用例 1/1。它依次核实：Tenant admin 在 ACTIVE Workspace 上得到暂停键；非 Tenant admin 发起为 `PERMISSION_DENIED`，多带参数为 `INVALID_PARAMETERS`，ACTIVE 上恢复为 `TARGET_STATE_CONFLICT`；暂停收敛到 `SUSPENDED`，期间本人不可进入、Workspace scope 新动作 `SCOPE_GUARD_FAILED`、重复暂停冲突，列表给出恢复键；以 CONTROL（Channel owner）回读：Channel 已归档，roster 只剩 CONTROL；成员的托管私钥直连 Relay 发布被 Relay 拒绝，且该成员已读不到该 private Channel 的 discovery——清出 roster 后读取随之关闭；恢复收敛到 `ACTIVE`，Channel 已解档，roster 重新包含 ACTIVE 成员的身份，直连发布被接受，`workspace#tenant` 关系仍在。

破坏核验（均已还原并复验）：Worker 暂停分支去掉归档步骤，用例在「Relay 上的 Channel 应已归档」失败；去掉清空 roster 步骤，用例在「暂停后 Channel roster 应只剩 CONTROL」失败（roster 中多出成员）。暂停与恢复各录制一份真实终态 history（`worker/replay-tests/testdata/component_task_workspace_suspend_history.json`、`…_restore_history.json`）并加入 `TestComponentTaskReplay`；再次去掉清空步骤时暂停 history 重放报 `TMPRL1100`，还原后通过。建立链的两份既有录制照常重放，说明新分支未改变建立路径。

未覆盖：Tenant 暂停与恢复（DD-96）不在本能力内；`ERROR` 路径与派发 `ABORTED` 置 `ERROR` 只有 Worker 与 Core 单元覆盖，未在真实环境注入 Relay 故障；原生设备在暂停期间的登记与撤出（投入推迟、撤出按缺席查证）由代码路径与单元覆盖，未以真实原生端演练。
