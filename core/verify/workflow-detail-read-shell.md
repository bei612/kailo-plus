# 工作流详情读取状态的原版面板恢复

## 权威、影响与边界

- 权威：用户要求固定官方原版一致性；Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::WorkflowDetailPanel` 在加载/失败时仍保留详情外壳、标题 Skeleton、显式关闭控制及滚动区域。`desktop/src/shared/ui/skeleton.tsx::Skeleton` 已在共享 `sidebar/skeleton.tsx` 迁移，本批直接复用。
- 影响：共享 `agents.tsx::AutomationList` 的实际 Dialog 设置 `showCloseButton=false`，其 `AutomationDetail` 原 pending/error 提前返回 Notice/ReadFailure 丢失原关闭控制。本批只恢复该真实读取消费者的原版面板；Web/Desktop 管理面仍由 `client.automation` 经 BFF 读取。Mobile 不新增入口。无契约、持久化、迁移或写调用变化。
- 副作用：没有增加新权威、默认作用域或网络请求。未通过 `validAutomationDetail`、资源/工作区及分页验证时，不展示名称、定义、版本或动作；失败仍沿现有 `AgentReadFailure` 分类和显式重试。原版不可用时 Trigger 按钮不直接照抄：未有真实 `canRun` 的读取状态不创建动作入口，这是逐项明确的治理差异。
- 异常：pending 仅原 Skeleton；拒绝/错误/结构或 scope 不符显示真实失败而不是空定义；失败不自动重试，关闭卸载后晚响应沿既有 `useLoad` current 标记丢弃。`locked` 时显式关闭按钮禁用，外层 Dialog 原 Escape/外部点击锁保留。原 `useLoad` 的 key/round 清理及本批无写调用，因此不引入新的结果不明、幂等、重投递或 quota 状态机。

## 实现与证据范围

- 源码先写入私有候选 `/volumes/data/kailo/tmp/agent-activity-native.Lkr7rT/apps`，主线程复核后通过 apply_patch 将精确两路径增量接回正式 apps；未修改公共 index。独立基线 `/volumes/data/kailo/tmp/ui-workflows-dialog-20261010.8HDD5h/detail-loading-base` 在正式 HEAD `c442f2bb6e5c9e4db624057fe756272574a807f2` 时保存；`agents.tsx` 与正式工作树逐字比较退出 0，已冻结删除弹窗内容不在该增量中。
- 源补丁 `detail-loading-owned-source.patch` 两路径 +90/-2，SHA-256 `6dcf1174b0fb068047b059b856aa910d75821c35bc7b1a0b44a4cb89a3f17757`。在正式 apps 执行 `git apply --check --whitespace=error /volumes/data/kailo/tmp/ui-workflows-dialog-20261010.8HDD5h/detail-loading-owned-source.patch` 退出 0；这仅证明补丁可应用及空白检查，不是交互验收。
- 实现后在原 `workflow-definition.test.tsx` 增加四项真实 AutomationManagement/BFF 消费检查：中英文加载状态原几何/关闭/晚响应不重开；403 和错误 scope 状态不暴露定义、保持显式关闭，并沿原授权读取重试。
- 按本轮集中验证安排，未启动类型检查、DOM 重试、构建或部署；新增四项尚未执行，真实生产破坏/还原亦未执行。此前删除弹窗及 pages 检查的 0 cases worker 启动失败不冒作本批通过或失败。
- 本批没有新候选截图；旧 `4c099a5f9b508f7df47b9fc923fe37ab7375aa70` 部署截图不能证明候选布局已验收。该接回不等于已提交/push，不能声明本批完整还原或生产就绪。

## 固定上游对照纠偏

`WorkflowStepCard.tsx` 的 `add_reaction` 原生输入确为普通 Input；`WorkflowEmojiField.tsx` 的实际调用仅在 `WorkflowTriggerConditions.tsx` 的反应触发分支。未把自拟 Emoji Picker 填入原动作编辑，也未启用当前合同未准入的反应触发入口。

## 正式接回后的集中验证

主线程交叉复核后，两源增量及本回执已通过 `apply_patch` 接回正式 apps，删除批与 `pages.test.tsx` 的主线程更改原样保留。选定三路径 `git diff --check` 实际退出 0。沿原 `kailo-agent-receipt-xvkujx`（4 CPU、8 GiB、同额 memory+swap、UID/GID 1000:1000、镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`）集中执行生产类型、检查类型及删除/详情/独立 Workflows 三个既有 describe；启动前只有 sleep，可用内存 25 GiB，无新增构建。原 Wren 类型作业仍存在于其独立受限 SDK，已通知其 owner。

源投递句柄 36397 的逐文件 `cmp` 最终均为 0；类型句柄 36171 启动时，该投递最初返回的 running 尚未取终态，因此不将第一段类型结果单独称为完整冻结输入通过。投递终态后输入不再修改，后续检查类型与 DOM 阶段使用这份冻结输入。日志 `/volumes/data/kailo/tmp/ui-workflows-dialog-20261010.8HDD5h/delete-detail-pages-final.log`。

36171 最终退出 1。串行命令 `node node_modules/typescript/bin/tsc --noEmit` 与 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json` 均已实际退出 0（首段输入边界如上）；之后一次 `node node_modules/vitest/vitest.mjs run test/workflow-delete.test.tsx test/workflow-definition.test.tsx test/pages.test.tsx -t "original workflow delete dialog with the existing governed command|original workflow detail loading and failure shell|independent shared Workflows page"` 退出 1。原输出 `Failed to start forks worker`、`Timeout waiting for worker to respond`，三个文件均未启动用例：`Test Files no tests / Tests no tests / Errors 3 errors`，61.70s，transform/setup/import/tests/environment 均 0ms。没有业务断言结果，不能报通过或归因产品回归；停止重试、不修改超时或池配置，真实生产破坏/还原仍未执行。候选截图、部署与发布仍未验收。
