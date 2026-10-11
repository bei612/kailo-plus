# 原 Workflows 列表加载模块恢复

2026-10-11。基底 `3b5a589e8b8fba2b4241d485ef1231a9aead45a1`；固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/workflows/ui/WorkflowsView.tsx::WorkflowsListSkeleton`
及 `WORKFLOW_CARD_GRID_CLASS`。关联 REQ-24、DD-75 与用户原版一致性要求。

## 权威、影响、副作用与异常

原模块是四张卡片、每张八个 Skeleton，并按容器宽度切换一至三列。
共享 `AutomationList` 原先把这整段替换为单行载入文案，属于缺失需恢复，
不是已授权治理差异。现将原完整 DOM/class 原样迁入
`client-kit/ts/platform/src/react/workflow-list-skeleton.tsx`，复用原已共享
Skeleton；唯一消费者为 `agents.tsx::AutomationList` 的 pending 分支。
原常量在该模块只有一个消费点，等值内联；不增加公开包 export。
Web `PlatformApp` 与 Desktop 既有 Workflows 宿主仍消费同一共享页面。

不改 workspace 预准入加载态、BFF 请求、canCreate、分页、错误重试、表单、
Temporal 或任何持久状态。请求未完成只显示骨架，不推定有写权限；空结果及
canCreate=false 保留原行为；未知/错误响应仍走已有失败面，不显示成功。
切换 workspace 的卸载/迟到响应处理仍由原 useLoad 管理。无新增额度、权限、
错误枚举、数据库、跨语言字段或外部副作用。

## 实际验证

使用既有 `kailo-web-thread-tooltip-sdk`：4 CPU / 8 GiB memory+swap、none
网络、Data 私有快照。运行前只有 sleep，MemAvailable 37 GiB；未新建镜像、
未运行全量或发布构建。原命令：

```text
node node_modules/vitest/vitest.mjs run test/workflow-definition.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
```

- 正向：35 passed，exit 0。真实 AutomationManagement+BFF deferred 读取，
  验证四卡/32条骨架、原 class、授权完成前无创建卡、拒绝创建的空结果后无骨架。
- 反证：仅私有 `AutomationList` pending 恢复旧 Notice，定点同一检查实际
  `expected ... length of 32 but got 0`，exit 1；其余34项明确 skipped。
- 按原候选字节还原消费者后，原整个套件35 passed，exit 0。
- 规范四语言/类型/全量未在本小批重复运行；DOM 用例不能替代实际新版视觉验收。

日志、截图及原始请求均在 `/volumes/data/kailo/tmp/web-profile-frame.QTuuqK`：
`workflow-list-positive.log`、`workflow-list-negative.log`、`workflow-list-restored.log`。

## 真实浏览器与未覆盖范围

复用 playwright-cli，系统 Chrome 的 sandbox 保持启用；普通账号凭据经受控文件
与匿名 FD 注入，不共享会话。首次旧 OIDC 事务返回 missing transaction，重新从
正式入口正常认证成功；未降低认证或浏览器边界。浏览器 build-info 实际仍为
`sha256:f530ffa636a6980aaa21aa84ef5d44c83ae47d831504e95f173614f21f0a345e`
（固定 032b9c3），不是当前 main 或本候选。

以下四图已逐张打开：`agents-current.png` 显示定义卡片与安装区域，不是原完整
AgentsView；`workflows-current.png` 为真实原路由访问，预览开关未开且提示侧栏
未显示；`workflows-settled.png` 显示现存空列表创建卡；`dm-refresh-current.png`
显示正常私聊与侧栏。`workflows-current.yml` 曾捕捉原单行加载态，但截图执行时
列表已完成，不能称捕获到骨架修复前截图。没有修改开关、创建工作流或发送消息。
候选未部署，修复后截图、Windows、Mobile 均未验收。

一次普通 DM 刷新于 14:47:43–48 UTC 记录42条已完成 API 请求，均200、5–80ms。
user-state 与 conversation-participants 各4次；两者无query（原CLI请求表可核）。
stream为长连接，不包含于完成请求计数，CLI表记录200。Agents 首次刷新采集脚本
因运行上下文没有 URL/setTimeout 报错，不计为完整证据。后续单次 DM 采集使用
Playwright 方法完成，无循环压测。原件 `dm-refresh-requests.json`、
`requests-after-refresh.txt`。成功这一轮不取消历史预算耗尽失败。

完整模块剩余及四分类增量见[既有差异台账](buzz-restoration-checkpoint.md)。
本批仅原列表加载模块，不称 Agents/Workflows 完整还原或生产就绪。
