# 任务视图未知状态拒绝

2026-09-25。依据 `.design/03` §6 的 TaskProjection 派生权威、`.design/06` §9 的受权任务视图、`apps/06` §4 的 `UNKNOWN` 失败分类。此项只修复 BFF 的任务读取，不开放取消或重跑入口。

## 变更前核对

1. 权威：任务运行状态来自 Temporal/Worker 与 ExternalExecution，Core 的 TaskProjection 只读。BFF 不得把数据库中存在但不属于四语言契约的状态值解释成“没有状态”。
2. 影响面：GitNexus 对 `governance_api::task_view` 报 `LOW`，直接调用者为 `get_task` 与 `list_tasks`，涉及两条本人任务读取路径；不改数据库、契约字段、Temporal、上游源码或三端控制入口。
3. 副作用：原实现对可选 `reason_code`、`approval_status`、`workflow_kind`、`task_status` 使用 `and_then(parse)`，未知非空值静默变为 `None`。现在只允许数据库 `NULL` 映射为 `None`；未知非空值返回带 operation ID 的 `UNKNOWN/DEPENDENCY_UNAVAILABLE` 错误体，不返回可误读的 TaskView。
4. 边界：同一列表有一条未知状态时整页拒绝；详情同样拒绝。已知枚举和真正的 `NULL` 沿用原映射，投影新鲜度及终态对账规则不变。错误不触发 Start、Cancel 或重跑，也不改变任何事实。

## 实际验证

- 受限 cgroup 中的定向测试 `cargo test --manifest-path core/Cargo.toml -p kailo-core unknown_persisted_task_enums_do_not_become_absent_fields` 通过，四个非空未知枚举都被拒绝。
- 破坏验证：仅把 `task_status` 临时恢复旧 `and_then(parse)` 后，同一测试退出码 `101`，断言发现原实现返回 `Ok(TaskView { task_status: None, ... })`；随后恢复修正。
- 恢复后的 `./tools/check.sh --full` 在 `MemoryMax=16G`、`CPUQuota=500%` cgroup 中退出码 `0`，十组门禁通过。数据库迁移实演因该命令未提供 `DATABASE_URL` 而 `SKIP`；本次没有数据库迁移。
- 提交前 GitNexus `detect-changes --scope all` 报 `CRITICAL`、17 条流程，并把 `ApprovalRow/decisions` 等列为改动符号。已逐块核对 `git diff --check` 与实际 diff：生产代码只改 `task_view` 的错误回应及四个可选枚举解析，另增一个同文件单测；审批结构、查询及决定逻辑均无文本改动。图的原始索引把 `task_view` 定在旧文件 172–198 行，新增代码使后续符号行号移动，因此不能把 `CRITICAL` 直接降成“无影响”；对图给出的真实调用者 `get_task/list_tasks` 已核对共用 `task_view`，全量门禁及破坏测试覆盖这条读链。

任务取消与重跑仍需独立完成 Governed Action、BFF 控制入口、Web/Desktop 操作和 Temporal 真终态验证；此项不将其计为已完成。

## 共用审批原决定 UNKNOWN 保留与定向验收（2026-10-04）

本节只追加已实现事实，不改写上述历史验收。基准为
`aa19c8fe39cb7e71aa01c354a4a121e05c881998`；两份共享 TS 选定补丁
共 +105/-14，其中保留原审批刷新/控制条件的继承窗口 +13/-7。
本次新增生产修复只在 `ApprovalPanel::run`，实现后在原
`test/governance.test.tsx` 增补七项检查，不改 i18n、契约或后端。

四步结论如下：

1. 权威：`.design/06` §4、DD-47/DD-54 固定每人不可变决定与同值 Update
   去重；`06-工程基线规范.md` §4 禁止把 UNKNOWN 当成确定成功或失败。
2. 影响：Web `web-client/web/src/platform/ui/PlatformApp.tsx` 和 Desktop
   `collaboration/desktop/src/app/routes/platform.$section.tsx` 仍消费同一
   `ApprovalsPage`。`client.ts::decide` 使用原 BFF，
   `governance_api.rs::decide` 先重验会话与 scope，再以固定 Workflow/approver
   Update 身份询问 Temporal；客户端不成为权限或审批权威。
3. 副作用：曾发生 TransportError/UNKNOWN 的原决定，在同值重试期间及其后
   遇到 403/409 时保留原 outcome、决定和 operation 引用；后续准入拒绝不能
   证明原决定未发生。只有原决定的确定回应才替换未知事实；首次确定拒绝仍
   显示拒绝。刷新清除旧确认框及统一控制条件的继承修复继续保留。
4. 边界：不生成新状态、队列、幂等键、API 或替代决定。重复拒绝与投影刷新
   不解锁批准/拒绝新意图，UNKNOWN 撤回仍不新增重试协议。本节是镜像内
   交互/类型证据，尚未构建或部署，不覆盖真实 Approval/Temporal E2E 或设备。

原资源预检后使用不可变 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU/8 GiB/swap 0、UID/GID 1000:1000，源与既有依赖缓存均在 Data。
Node v24.21.0、pnpm 10.33.4，原锁文件未改，原命令为：

```bash
pnpm install --offline --frozen-lockfile --store-dir /cache/pnpm-memory-read
pnpm --dir client-kit/ts/platform typecheck
pnpm --dir client-kit/ts/platform exec tsc --noEmit -p tsconfig.test.json
pnpm --dir client-kit/ts/platform exec vitest run test/governance.test.tsx
```

基线 session 48082 退出 0：生产/检查类型均通过，21 项通过（原 14 项加七项）。
私有生产变异保持检查不变：把 `run` 的 UNKNOWN 比对改为 `rejected`，session
38883 退出 1、四项真实断言失败；删掉原 `refresh` 的 `setConfirming(null)`，
session 53384 退出 1、一项真实断言失败。两个文件逐字 cmp 0 还原后，session
38855 退出 0，生产/检查类型及 21 项检查再次通过。原失败输出保留；自有 SDK
已清理。`git diff --check` 退出 0；未运行独立 TS formatter、全平台检查或 full。

最终 `governance.tsx` SHA-256 为
`0674720e4a1de8391c7cf7034c0cac4cfb065cd78f5afe823403b22fc30a1dad`，
`governance.test.tsx` 为
`b8eb805331cb28d420224108dc4d8976d1cfe07f3b31a1a4ac95e8f557bacf8f`。
SDK 原件目录为 `/volumes/data/kailo/tmp/codex-approval-intent-20261004.9zBREL/`：

- `baseline.log`：`58cb6536199d687c8a522f8084191c7c7945828f7e96afaaa112f05790f30cf8`。
- `mutation-persistence.log`：`57f33f92096495e409052a6bd370cb470924f0fe3939e877251a5dfcede3919b`。
- `mutation-refresh.log`：`2532950ea1e5f0e35ff53afc0bd8a3848e9b14292d0c444a67681db354ee71d1`。
- `restored.log`：`1e21222f92c95eab1f1126d574d482d44275a3fc2800e9e7f108f3c8fd06965a`。
