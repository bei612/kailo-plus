# 原工作流删除确认框恢复

## 权威与影响

- 固定官方 Buzz `779af8886caae1317b4de962082429867ab61503` 的
  `desktop/src/features/workflows/ui/WorkflowDeleteDialog.tsx::WorkflowDeleteDialog`
  及 `desktop/src/shared/ui/alert-dialog.tsx::AlertDialogContent` 是布局、文案、
  取消、等待与错误呈现基准。原 `max-w-md`、默认 surface、页脚按钮顺序和
  pending 行为共享迁移到 `client-kit/ts/platform/src/react/workflow-delete-dialog.tsx`。
- `.design/05` §2.9 的 `automation.delete` 为已有 `SYNC/EXPLICIT` 治理动作；
  `.design/06` §9 要求真实 `DELETED` 才移出活动列表，保留运行历史且不取消在途运行。
  原 `AutomationAction.prepare/submit` 仍是唯一写消费者。删除确认直接冻结既有命令
  后提交，不另建删除 API、Task 或状态权威；Web/Desktop 共用同一消费者。
- 影响范围为原 `AutomationAction` 删除分支、共享确认框、四条中英词条及原 Dart
  投影。没有契约、数据库、权限、调度或新入口变化。选定 pin 的真实名称用于确认；
  无可读 pin 不换成其他版本名称，按既有未命名呈现。

## 副作用与边界

- 原准入条件、Resource version、显式确认、幂等键、`inFlight`、Operation/AE 关联校验
  及记录后原列表重读均保留。不乐观移除卡片，不把 `DISPATCHED` 当作删除终态。
- `UNKNOWN/EVALUATING/ALLOWED+NOT_DISPATCHED` 保留原冻结请求，禁止关闭；再次操作
  核验同一请求，不生成第二幂等键。未知使用中性状态，不套原删除失败错误文案。
- 已确认拒绝保留原错误框及取消；pending 禁止重复点击与关闭。页面未完成原任务读取、
  存在关联在途动作或缺管理资格时沿原门禁拒绝。正文名称使用 React 文本转义。
- 已授权治理差异逐项为：保留历史与在途运行说明、实际准入/Operation 状态、未知核验
  按钮和关闭锁。不是以治理名义重绘原布局或另做通用编辑表单。

## 本轮事实

- 候选在 Session UI 已冻结批次之后独立增量；主线程交叉复核后已用 `apply_patch`
  精确写入正式五源，逐路径 `cmp` 一致，选定路径 `git diff --check` 退出 0。
  公共索引、既有 staged 词条及其他脏内容未改；源码已写入不等于验证通过。
  本批五源路径 `+196/-6`，其中 Dart 为原 `tools/gen-platform-i18n.py` 实际生成。
- 2026-10-10 18:26 UTC，沿现有 `kailo-ui-status` 正常 SSO 会话，仅打开和取消删除
  确认，未点提交、未删除对象。实际 `/app/platform-build-info.json` 为
  `sha256:9e1bd3032cefb32ac76fc5e64e9ed0fa7d8b45091acfe2e5556d990b407e1761`，
  对应旧部署 `4c099a5f9b508f7df47b9fc923fe37ab7375aa70`。
- 两张实际截图均已打开复核：
  `/volumes/data/kailo/tmp/ui-workflows-dialog-20261010.8HDD5h/agent-definition-old-4c099.png`；
  `/volumes/data/kailo/tmp/ui-workflows-dialog-20261010.8HDD5h/workflow-delete-old-4c099.png`。
  后者证实原删除入口仍使用 88vh 通用编辑器，不是本候选恢复后的视觉验收。
- SDK `kailo-agent-receipt-xvkujx` 实查 4 CPU、8 GiB memory/swap，复用原 Data 缓存。
  50249、34083 均在 Dart 生成成功后因本次命令错误引用根 TypeScript 路径而退出 1，
  两次均未开始类型或 DOM，不算业务失败。未安装工具或改变依赖/超时。
  只读解析实际包内依赖后，10121 原包入口生产/检查类型均退出 0；DOM 的 forks
  worker 等待响应超时，退出 1，实际 0 cases，transform/setup/import/tests 均 0ms。
  不是业务断言失败，也不是交互通过；不修改配置/超时或盲重试，不以 0 cases
  制造真实生产破坏/还原证据。该反证与交互验收仍未执行。
- 原终态命令在 `/evidence/agent-activity-native.Lkr7rT/apps/client-kit/ts/platform`
  串行执行 `node node_modules/typescript/bin/tsc --noEmit`、
  `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`、
  `node node_modules/vitest/vitest.mjs run test/workflow-delete.test.tsx`。
  实际日志为 `/volumes/data/kailo/tmp/ui-workflows-dialog-20261010.8HDD5h/delete-package-consumer.log`；
  最初两次入口失败日志为同目录 `delete-final.log`、`delete-corrected-input.log`。
- 没有新 build、部署、Windows 设备验证或新候选浏览器截图；不称完整 Workflows 还原。

## 同批原 Workflows 检查定位纠正

原 `pages.test.tsx` 的 `mount` 仅对 Agent 页面查询实际 portal，Workflows
详情迁入原 Dialog 后仍在旧 host 内找运行历史，导致旧 full 的相关断言取到
空节点。现只将 Workflows 纳入同一 portal 查询范围；导航检查改为断言原
`workflow-card-workflow-one` 存在，不再要求已恢复原生名称的卡片暴露 UUID。
原 UNKNOWN、跨 scope、失权、错误枚举、分页与 GET-only 断言均未移除或放宽。
没有改变生产布局、API、权限、状态或旧数据，检查文件差异为 `+4/-3`。

在同一已空闲 SDK 中仅同步该检查文件，执行原命令
`node node_modules/vitest/vitest.mjs run test/pages.test.tsx -t 'independent shared Workflows page'`。
实际作业 89773 退出 1：`Timeout waiting for worker to respond`，0 cases，
不是这组断言已通过。日志为上述目录 `workflows-page-root-final.log`，SHA-256
`60b17d10606da879b36c61abaadfe1f82705f2cf7ebb555e601ae0a86d4c35ae`。
未改检查超时、安装依赖或重新启动相同检查；真实反证和还原验收仍缺失。

并行 full 作业 75258 固定树 `aa3606135f46252cbc5fcd7cac334b98b1f7ae83`
仍包含上述旧定位，且不包含本批删除弹窗、Cells 与 Wren 增量。核对该树及
实际 `git archive`/`tar` 进程后，仅取消本任务这一过时的全量检查进程组，
实际退出 143；随后三条导出进程均不存在。不是因观察超时判断进程已停止，
没有启动替代 full，也未停止队友验证或其他项目。源码导出阶段的日志在
`/volumes/data/kailo/tmp/component-delivery-commit.CVKZK5/full-current.log`，
SHA-256 `3425d55de160579f35725421fd89d59e4a59fc821204d89abdcef3f2103e30f7`。
本批全量门禁没有通过，集中验收须使用最终批次而非此旧树。

主线程批准接回详情加载面板后，36171 在同一 4 CPU/8 GiB SDK 集中复核本删除 describe、详情加载 describe 和独立 Workflows 页面 describe。生产类型及检查类型命令均实际退出 0；首段投递边界及完整命令见 [详情读取回执](workflow-detail-read-shell.md)。三文件同一次 Vitest 均 `Failed to start forks worker / Timeout waiting for worker to respond`，61.70s、0 cases、3 errors，最终退出 1；不是删除断言通过或失败。日志 `/volumes/data/kailo/tmp/ui-workflows-dialog-20261010.8HDD5h/delete-detail-pages-final.log`。停止重试，未变更超时/池配置，也未伪造无法执行的生产破坏/还原证据。
