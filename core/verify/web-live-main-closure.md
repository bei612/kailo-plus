# 已在线 Web 恢复源码的主干收口

## 范围与权威

2026-10-11，以 main `1e8811854de99cefabfca2cf79cdd0cba93e79d8`
对照现网冻结树 `252cf1239c04717370df803dec302aba354a8e32`，原 Web 构建
输入存在 47 个文件差异。直接发布该 main 会移除已经在线的线程布局、历史导航、
草稿跳转、DM 未读预览和工作流控件，因此精确取消当次 buildx，不切换现网。
取消结果、39 项作者线程消费复验见[作者资料回执](message-author-label.md)。

本批遵循 REQ-24、DD-75、DD-87，以及 `.design/07` §4 的共源边界。
固定 Buzz 为 `779af8886caae1317b4de962082429867ab61503`，固定 Buzz Web 为
`a6766c482533d028582d0efcfd3740769f86217c`；只读核对 `.references`，不在其内执行。
本批选取 44 个 Web/shared 现网路径，合并 main 作者检查的 DM 头像用例，补齐
4 个 Desktop 实际共享消费者及原生成的 Dart 词条，共 50 个源码路径。
生成合同、Agent 时间字段、Core、组件与来源 manifest 均未纳入；main 的系统
消息 signer 过滤保留，不能被旧现网作者文件覆盖。无新增依赖或数据库迁移。

## 全部生产差异分类

下表覆盖本批 33 个非检查源码路径；另外 17 个既有检查文件验证这些实际消费者。
不是把一次 git diff 的文件枚举等同于整个产品已经逐项验收。

| 本批路径（省略共同目录） | 固定 Buzz 路径、符号与分类 |
| --- | --- |
| shared `messages/thread/ThreadViewModeToggle.tsx`、`useThreadViewModeSwitch.ts`，Desktop `features/channels/ui/` 同名两文件 | `desktop/src/features/channels/ui/ThreadViewModeToggle.tsx::ThreadViewModeToggle/shouldRestoreThreadToggleFocus`、`useThreadViewModeSwitch.ts::useThreadViewModeSwitch` 共享迁移；Native 改为薄导出，原图标、焦点和阅读锚点算法保留 |
| shared `messages/thread/index.ts`、`package.json` | 上述原模块的实际两宿主导出，无新功能或第三方依赖 |
| shared `use-history-search-state.ts`、Desktop `shared/hooks/useHistorySearchState.ts` | `desktop/src/shared/hooks/useHistorySearchState.ts::useHistorySearchState` 共享迁移；原 microtask/replace/无变化不推栈规则保留，Native 仅绑定原 Router |
| Web `app/platform-navigation.ts`、`ui/PlatformApp.tsx` | `desktop/src/features/channels/ui/useChannelPanelHistoryState.ts::useChannelPanelHistoryState`、`useNavigationGuard.ts::useNavigationGuard` 的实际宿主接线；只传引用、会话隔离和 BFF 属于已授权适配 |
| Web `ui/ChannelPane.tsx`、`ChannelThreadPane.tsx`，shared `messages/thread/AuxiliaryPanelShell.tsx`、`RightAuxiliaryPane.tsx` | 原 `desktop/src/features/channels/ui/ChannelPane.tsx::ChannelPane` 的布局控件、锚点恢复；稳定 aside/编辑器 owner 是保留原 UNKNOWN 意图的明确宿主差异，尺寸、class、原正常退出动画不改；拒绝/撤权立即移除旧线程 |
| Web `ui/InboxDrafts.tsx`、`InboxPane.tsx`、`ForumPane.tsx` | `desktop/src/features/messages/ui/DraftsPanel.tsx::openDraftEntry/sendDraftEntry` 原打开语义恢复，删除自拟嵌套 DraftEditor；原确认发送只携同会话草稿 key，先消费一次性导航标记，再进入既有 sendIntent 链 |
| Web `ui/useWorkspaceThread.ts`、`InboxThreadPane.tsx` | 原消息 h 对应 native channel；可信 ConversationView.channelId 校验、缓存键与 BFF binding ID 分工为已授权治理适配，缺字段拒绝，不从消息猜 scope |
| shared `sidebar/MoreUnreadButton.tsx`、`useSidebarUnreadOverflow.ts`、`conversations/conversation-list.tsx`，Desktop `features/sidebar/ui/AppSidebar.tsx`，Web `ui/ConversationSidebar.tsx` | `desktop/src/features/sidebar/ui/MoreUnreadButton.tsx::MoreUnreadButton/canPreviewUnreadDm/visibleUnreadDmPreviews`、`desktop/src/features/sidebar/lib/useSidebarUnreadOverflow.ts::useSidebarUnreadOverflow` 共享迁移；原 1v1、三头像与滚动优先级保留；Core 已读、HUMAN 身份、消息级头像证明和两宿主传输为逐项授权适配 |
| shared `workflow-channel-combobox.tsx`、`workflow-form-canvas.tsx`、`conversations/popover.tsx`、`profile/buzz/shared/ui/portalled-scroll-area.tsx` | `desktop/src/features/workflows/ui/ChannelCombobox.tsx::ChannelCombobox`、`WorkflowFormBuilder.tsx::WorkflowFormBuilder` 共享迁移；`desktop/src/shared/ui/PortalledScrollArea.tsx::PortalledScrollArea` 原样保留。真实授权目录、执行器清空、新 scope 准入和审批引用保留为治理适配；原私聊 Workflow scope 仍是缺失，未开放 |
| shared `workflow-delete-dialog.tsx`、`agents.tsx` | `desktop/src/features/workflows/ui/WorkflowDeleteDialog.tsx::WorkflowDeleteDialog`、`WorkflowDetailPanel.tsx::WorkflowDetailPanel` 的原紧凑确认框及读状态外壳恢复；冻结 ActionCommand、UNKNOWN 核验、关闭锁、历史保留说明为逐项治理差异；移除安装卡自拟 UUID 副标题，精确引用仍在授权详情 |
| shared `workflow-steps.tsx` | `desktop/src/features/workflows/ui/WorkflowStepCard.tsx::StepConfigFields/WorkflowStepCard` 已支持分支的原 Input、textarea、label、placeholder 恢复。审批 policy 和固定 workflow channel 属于授权适配；未准入动作与 Run controls 仍缺失，不声称完整还原 |
| shared `src/i18n.ts`、`client-kit/dart/lib/shared/platform/platform_text.dart` | 原英文与默认中文为已授权差异，Dart 由原 `tools/gen-platform-i18n.py` 生成。未带用户原暂存 Projects 词条，也未带本候选没有调用方的 `dm.verifyPublicKey` |

shared 表中 React 路径位于 `client-kit/ts/platform/src/react/`，Desktop 位于
`collaboration/desktop/src/`，Web 位于 `web-client/web/src/`。
详细副作用及异常审阅沿已有[线程历史](thread-history-restoration.md)、
[线程布局](thread-view-mode-restoration.md)、[DM 未读](dm-unread-overflow.md)、
[频道选择](workflow-channel-chooser.md)、[步骤字段](workflow-step-fields.md)、
[删除确认](workflow-delete-dialog.md)、[详情读取](workflow-detail-read-shell.md)保留。
这些历史回执的失败没有回填为成功；本节以下为新冻结输入的实际结果。

## 精确输入与验证

私有 Data 输入 `/volumes/data/kailo/tmp/web-live-main-closure.cAiUmD`，私有 index，
源码树 `5a44fed8e8ff890a297137a56c32dc9c285a3cc0`，相对上述 main 为
50 路径 `+2506/-597`。不改全局暂存区；原五个 blob 全部逐项一致，其中
i18n/Dart 与本批同路径但不是同一 staged 增量，提交后也不能覆盖其原 blob。

复用 SDK 镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
容器 `kailo-web-live-closure-caiumd`，4 CPU、8 GiB 内存和同额 memory+swap、
UID/GID 1000、network none。预检 available 43 GiB，复用既有 Data 依赖，
不安装工具、不改锁文件、不使用共享可写编译缓存。每轮结束后才修改下一轮输入。

- 初次投递错误为 Dart 默认元数据目录权限、共享 TypeScript 链接根及 Native
  既有 focus-scope 包链接缺失；修正私有 mount/链接，不改产品来迁就环境。
  原失败 `types.log` 保留，其中 Web `tsc --noEmit` 已实际为 0。
- 原生成器、shared `tsc --noEmit`、`tsc --noEmit -p tsconfig.test.json`、
  Desktop `tsc --noEmit` 均实际为 0：`types-corrected.log`，SHA-256
  `aff14253f2c471789916827440762f924fb9b32d8622b3278de5a539f55eb5d4`。
- 原 Vitest 命令使用 `--maxWorkers=1 --pool=threads` 串行原文件，不修改超时。
  shared 九文件第一轮 367 passed / 22 failed；Web 九文件 234 passed /
  3 failed；Native 原两个 Node 文件 6/6、exit 0。总 exit 1，完整
  `tests.log` SHA-256 `6ba68208c06be7ff2dd4c719e0d979bdf7720d06abb30579017b97cffb8a7c18`。
- 22 失败都在 pages 旧定位：兄弟输入的 htmlFor、原 Edit/删除按钮、卡片摘要
  与详情引用位置、精确原 modal backdrop。仅修正检查定位和原版断言，所有
  payload、UNKNOWN、幂等和撤权断言保留。Web 三失败为录音夹具 Navigator
  userAgent 的非法继承，投递原真实值后原 Composer 47/47、exit 0。
  `corrected-checks.log` 保留 pages 269 passed / 1 failed（遗漏的旧卡片
  Report 断言）、Composer 47 passed 和检查类型 0；SHA-256
  `012dcfe1175f060a3b8be7e6febc8d2eea249833ed090dd49249b7e9c8f77eca`。
- 最后把 Report 和版本引用断言移到实际授权详情，原 pages 全文件 270/270、
  exit 0，18.36s，`pages-final.log`。因此分轮最终覆盖 shared 389、Web 237、
  Native 6 全通过；不是一次全量门禁通过。React act 与 jsdom scrollTo 警告保留。
- 新字段不涉及业务 wire contract；四语言 contract 重新生成无适用对象。
  本轮未重跑全局检查、未重复新建反证检查；既有真实变异及尚未执行项仍按
  上述各回执记录，不能把当前正向通过当作所有反证均已完成。

## 视觉、提交与部署边界

正常账号已实际打开并复核现网 e2fd 七张图：频道、个人资料设置、快捷键、
Workflows、创建工作流、Projects、Pulse。原件位于
`/volumes/data/kailo/tmp/full-diff-visual-20261011.3UNoEB`。这些只证明旧现网，
不覆盖本批合并后的作者修复，也不覆盖所有页面/弹窗/状态、Windows 或 Mobile。
完整原版截图对照、三个独立 HUMAN 与多 Agent 稳定协作、组件菜单和端到端治理
仍须实际验收。本回执写入时只生成提交候选，没有新 Web 镜像、切流或安装包。
不声称全量 diff 已逐项闭合、100% 还原或生产就绪。
