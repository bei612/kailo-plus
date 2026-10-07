# Inbox 原版筛选状态与 DM 回复草稿恢复

关联 REQ-24、DD-40/74/75、ADR-09。固定 Buzz 源码 `779af8886caae1317b4de962082429867ab61503`，来源为只读 `.references/buzz`；本批没有恢复旧工作流引擎、开放未授权事件种类或增加第二份已读状态。

## 全模块差异与本批闭环

对固定 commit 的 `desktop/src/features/home/` 全部 43 个文件逐个执行 `git show` 与当前对应路径 `cmp`：7 个字节相同、19 个有差异、17 个原路径缺失。此为完整路径/内容差异清点，不把 19 个差异或 17 个缺路径笼统认定成治理改造，也不声称所有差异已经补齐。已原样保留的是 focusRefetchPolicy.test、inboxSelection 及测试、HomeLoadingState、useFeedItemState、useHomeInboxReadState 及测试。

原 `desktop/src/features/home/ui/InboxFilterMenu.tsx::InboxFilterMenu` 有八类：All、Projects、Mentions、Threads、Needs action、Agents、Reminders、Drafts。当前真实链为五类（All、Mentions、Threads、Agents、Drafts）；DM 分组、完整消息窗口、已读、隐藏 DM 重开和原布局此前已恢复，本批不重复实现。原隐藏 DM 与 resize/auto-selection 等部分已共享迁移；原缺路径不是全部功能缺失的证明。

尚缺三类的真实来源：`desktop/src/features/home/lib/projectInbox.ts` 与 `inbox.ts::buildInboxItems` 使用仓库工作事件（1618/1621 等），不是“项目频道任意消息”；`needsAction` 来自原 personal feed（包括原 46010 工作流批准事件），不能把平台审批结果塞成未签名原事件；Reminders 的 `useHomePersonalInbox`、`HomePersonalInboxDetail`、`inboxListRows` 和完整 reminders 模块尚缺相应治理后的读写链。现有 contracts/Core/BFF 客户端无这些原 personal feed 读取消费者；本批保留缺项，不展示无数据执行链的三个按钮。Projects/Needs action/Reminders 仍是交付差距，而不是从目标删除。

本批实际恢复：

- `desktop/src/features/home/useHomeDrafts.ts::useHomeDrafts` 的原选择 effect 提取为既有共享 inbox-surface 的 `useInboxDraftSelection`。Web 与 Desktop 两处真实调用：窗口尚未测量不抢选择；宽屏选择首草稿；窄屏只展示列表；删除当前项后重新选择；离开 Drafts 清除选择。没有本地已读权威新增。
- 原 `InboxListPane` 的过滤专用空态与提示迁为共享 `InboxEmptyList`，Web 不再把 Mentions/Threads 一律显示“No activity yet”；Desktop 不再另留硬编码英文副本。已有五类菜单保持原顺序；原活跃草稿计数补回筛选按钮 aria 状态。七项词条由主线按同源 i18n 维护。
- Web `InboxThreadPane` 已将私聊回复草稿保存在 `thread:<native channelId>:<root>[:<reply>]`，但 `InboxDrafts` 只按平台 Conversation ID 找目标且拒绝 DM parent，导致真实已有草稿打不开。本批按原线程/普通消息草稿的既有命名分别匹配 native channel ID / Conversation binding ID；歧义拒绝，不把两个 ID 当可互换别名。恢复时复用已有 InboxThreadPane、Composer、conversation 消息/上传/已签引用链，保留 root、指定 reply、原草稿键与自动发送意图。参与者展示来自已核验目录，不能用其他会话人员填入当前私聊。

## 实施前四步结论

1. 权威：REQ-24 规定原版筛选与草稿体验，DD-74 规定共享呈现，DD-40 规定读标记由 Core 保持权威。原本机草稿正文继续使用已隔离身份和 origin 的现有 store；没有 Core 正文复制、私钥暴露或新同步需求。
2. 影响：shared inbox-surface、Web InboxPane/InboxDrafts、Desktop InboxListPane/useHomeDrafts 及各自实际消费检查。没有新增数据库字段、契约或迁移。Mobile 不消费 TS Inbox，本批没有 Mobile 恢复声明。普通 DM 草稿仍用原 binding ID；线程 DM 草稿继续用原 native channel ID，旧格式无需迁移。
3. 副作用：选择/空态不发布任何事件。打开/发送 DM 草稿先消费可信 Conversation 参与者、ACTIVE 目录与原 visibility Host，隐藏或不可查证时不挂载编辑/自动发送消费者；scope 消失后卸载旧编辑器。正式发布仍由既有 BFF/Relay 重新授权，UNKNOWN 保留同一 sendIntent，不清草稿重试或伪报成功。
4. 异常：空列表/删除当前项回空态；未知 namespace、重复或碰撞目标拒绝打开；目录撤权属于 DENIED、绑定未就绪和不可查证 visibility 属于 PRECONDITION，未闭合原 personal feed 属于 BLOCKED。quota/capacity 的 LIMIT、幂等/版本 CONFLICT、发布 UNKNOWN 沿现有 Composer/transport 原分类处理，没有新增状态、重放机制或本机对账权威。隐藏私聊仍通过既有重开入口恢复，不在 Drafts 绕过隐藏状态直接发送。

## 实际证据及验收边界

使用现有 `kailo-agent-receipt-xvkujx`，实查 cgroup 为 4 CPU、8 GiB 内存与 memorySwap；执行前约 31 GiB 可用内存。只同步本批 owned 文件到 `/evidence/profile-settings-ortsoo.DRR20F/apps`，不运行全镜像构建。

共享既有命令 `./node_modules/.bin/vitest run test/inbox-surface.test.tsx`：9 passed，exit 0。私有 SDK 主动删掉“窄屏不自动选草稿”分支，实际 1 failed / 8 passed，exit 1；apply_patch 还原后 9 passed，exit 0。正式源码未作破坏。

Web 首次执行 `./node_modules/.bin/vitest run src/platform/ui/InboxDrafts.test.tsx src/platform/ui/InboxPane.test.tsx` 退出 1、两套 no tests：并行主线新 MessageContent 已同步，但 SDK installed platform 的 MarkdownMentionChip 包导出未同步，不能把此结果计为业务用例通过。后续结果另附实际命令输出。

按主线授权同步其实际共享组件与包导出后，同一 Web 命令真实结果：InboxDrafts 5 passed、InboxPane 14 passed，共 19 passed，exit 0。覆盖普通/指定回复 DM 草稿恢复、native channel/binding ID 混淆拒绝、真实参与者筛选、目录撤回卸载、隐藏 DM 不挂载发送消费者，以及既有读取/重开路径。消费者测试保留 React 异步 `act` 警告，未掩盖输出。

只在私有 SDK 把目标匹配退回统一 `item.id`，原检查实际 3 failed / 2 passed，exit 1；两条 DM 恢复与 ID 混淆保护均真实报错。apply_patch 还原后 InboxDrafts 5 passed，exit 0。正式文件与 SDK 对应生产文件无变异残留；没有通过删保护或改预期让反例变绿。

最终 Web 两套消费者再验 19 passed，exit 0。三侧 `tsc --noEmit` 第一次在并行主线新增共享 resolveMentionNames.ts 的严格索引检查报 120/129/160 三处错误，exit 2，Web/Desktop 因顺序命令尚未执行；主线修正该共享依赖并同步后，按 `client-kit/ts/platform` → `web-client/web` → `collaboration/desktop` 顺序执行三次 `./node_modules/.bin/tsc --noEmit`，整条命令 exit 0。owned 七个代码/测试文件 `git diff --check` exit 0，新增/删除为 +164/-90 行，另含本回执及主线统一词条，不以行数表示完成率。

本批未构建发布、未执行全局 full、未新增浏览器截图或 Windows/Mobile 设备验收。不将源码清点、局部类型或消费者检查称为八类筛选全部恢复、全量 Inbox 一致或生产可用。
