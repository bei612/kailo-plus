# Inbox 原版自动选择恢复与剩余差异

## 固定来源与本批已实现

归属 `REQ-24` / `V-REQ-24`、`DD-53`、`DD-74`，沿 `collab.user_state`
的 Inbox 呈现与真实已读消费者。源码基准是
`Buzz@779af8886caae1317b4de962082429867ab61503`，只读 `.references/buzz`。
实际路径/符号：

- `desktop/src/features/home/useHomeInboxAutoSelection.ts::useHomeInboxAutoSelection`。
- `desktop/src/features/home/ui/InboxFilterMenu.tsx::INBOX_FILTER_OPTIONS/InboxFilterMenu`。
- `desktop/src/features/home/lib/inbox.ts::buildInboxItems/getInboxConversationId`。
- `desktop/src/features/home/useHomePersonalInbox.ts::useHomePersonalInbox`。

迁移前本地 Desktop 自动选择 hook 与固定官方 `git show` 管道 `cmp` 退出 0。
本批把该 hook 原样迁到共享 `react/use-inbox-auto-selection.ts`；唯一源码差异
为来源注释、去掉 Desktop 私有类型 import、将原 `Pick<InboxItem>` 表示为完全
相同的两字段结构。Desktop 原路径只 re-export，原 HomeView 调用不变。

Web 原本初始选择为 null，宽屏没有首条详情；筛选后仍从所有行解析旧选择。
现在已授权行交给同一原 hook，完成测量后宽屏选第一条，当前选中行仍可见则
保留，筛选排除后重选，空列表清空；窄屏不冷开详情。详情只从实际筛选列表取。
未读筛选保留当前行，与原 HomeView 的选择优先行为一致，不因当前行变已读
突然跳到另一行。只恢复交互，不增加新卡片、菜单或已读写入副作用。

## 当前完整筛选范围核对（不是全量 Inbox 已完成声明）

| 固定官方筛选 | 当前实际消费者与差异 |
|---|---|
| All | 有真实聚合，但只包括当前接通种类，不等于完整官方 All |
| Projects | 已部署 9d718 版仍缺失；2026-10-11 读链候选接通仓库 root/Review/Task 聚合和原只读详情，见下方逐路径映射；没有据候选宣布线上恢复 |
| Mentions | 真实本人身份/作用域过滤的频道及 Conversation mention 已接入 |
| Threads | 真实本人参与 root/thread activity 已接入 |
| Needs action | 缺失需恢复；当前 feed 没有该种类，不能把任意 Temporal 状态卡片当原待处理 feed |
| Agents | 本人已准入 AgentInstallation 目录及真实作者查询已接入；不是上游全事件种类等效声明 |
| Reminders | 缺失需恢复；原 useHomePersonalInbox 消费 useRemindersQuery/groupReminders/countDueReminders，当前 Inbox 未接入该读取/完成/延期链 |
| Drafts | 当前真实草稿读写及详情已接入，菜单已有；不能声称同时恢复了整个 personal inbox |

当前 `collaboration/desktop/src/shared/api/tauri.ts::RawHomeFeedResponse` 只有
`feed.mentions`；`HomeScreen` 合并 mentions 与 threadActivity。Web `InboxPane`
读取授权 workspace/conversation 窗口，经 `inboxWindowEvents` 保留 9/40002
消息，再合并本人 Agent 作者查询。`client-kit/ts/platform/src/inbox.ts`
`aggregateInbox` 仍仅声明 mentions/activity。这些事实决定本批不能只加另外
三个空筛选，更不能恢复旧执行引擎绕过治理。完整 Home 源码树共 43 文件已按
固定 `ls-tree` 枚举，但本批不是全部 43 个文件逐行差异验收。

## 改动前四步结论

1. 权威：原 hook 已存在且与固定官方一致，缺口是 Web 未消费；属于共享迁移与既定原交互恢复，不需新契约。
2. 影响：共享 hook、package export、Desktop re-export、Web Inbox 选择消费者；本地 React 状态，无 schema/API/数据库/存量迁移，不触 Mobile 原生选中逻辑。
3. 副作用：Web 用现有 scopeKey 作为原 hook 的稳定行 ID，不能把两频道相同 root 合并。读取失败、UNKNOWN、身份切换继续按原准入清空/隐藏，不新增授权、正文存储或已读权威。自动选择不自动发送标记已读，手动点击仍走原 CAS。
4. 边界：零条目清空；加载中、无 feed、未测量、窄屏、草稿、显式选择、原 cold resolution 各保留原行为。新事件不改当前可见稳定选择；滤出行不残留详情。没有新增业务执行状态和结果不明处理，六类错误沿现有数据消费者。

## 实际验证范围

既有 SDK `kailo-agent-receipt-xvkujx`：4 CPU/8 GiB cgroup，用户 `1000:1000`。
执行前核对并发、内存与 pressure，未新起构建/发布。窄检查在
`/evidence/profile-settings-ortsoo.DRR20F/apps`，日志统一位于
`/volumes/data/kailo/tmp/settings-scale-20261007.VXUSoG/`。

- platform `tsc --noEmit`、`tsc --noEmit -p tsconfig.test.json` 退出 0；共享 8 项通过（`inbox-auto-shared.log`）。
- Web `tsc --noEmit` 退出 0。首次 Web 行为验证因 jsdom 未提供 `Element.scrollIntoView` 失败（`inbox-auto-hosts.log`），因为现在真实自动挂载详情触发原滚动；只在测试提供浏览器方法并断言实际调用，不给生产代码加假回退。
- Web Inbox 13 项随后通过，Desktop `tsc --noEmit` 退出 0（`inbox-auto-hosts-restored.log`）。测试有异步第三方组件 `act` 提示，未屏蔽输出。
- 私有 SDK 去掉宽度测量保护，共享验证准确退出 1（1 failed / 7 passed，`inbox-auto-shared-mutation.log`）；私有 Web 断开 hook 消费，实际页面验证准确退出 1（1 failed / 12 passed，`inbox-auto-web-mutation.log`）。两处均还原，与正式源文件 `cmp` 退出 0。
- 还原后共享 8 项、Web 13 项再次通过，退出 0（`inbox-auto-restored.log`）；本批 `git diff --check` 退出 0。

未部署、未新增浏览器截图、未做 Windows 或 Mobile 设备验收；主线统一做完整
检查和发布。本批不改变八类筛选缺口完成状态，不声称 100% 原版等效。

## 2026-10-11 项目读链候选的全量台账对齐

本节对齐既有差异台账，不重跑或替换整个上游分类统计。固定官方仍为
`779af8886caae1317b4de962082429867ab61503`；候选基底为
`b054e200a5ec90472c574d8ca1907b0c575ccdb8`，候选 tree 为
`a49b742f559c2e89cc7257b751b5e0ba2ed4ea21`，43 路径、+3303/-93。
该 43 路径为最初读链闭包统计。后续基于主线固定
`81786a99aea969cefac4c9ccaaf79713bb0c4f94` 与本批唯一 schema，原
`tools/gen.sh` 已独立生成四侧并加入同一候选，不夹带 Cells 未提交字段；
不能仅提交新枚举源码而遗漏生成物。验证及兼容边界见
[项目只读接线回执](../../../core/verify/inbox-project-read.md)。

以下官方路径均相对 `.references/buzz`，符号均由上述完整 commit 的
`git show`/`git grep` 核对。来源键只是避免表内重复长路径，不是另一注册表：

- A：`desktop/src/features/home/lib/projectInbox.ts::getProjectInboxReference`。
- B：`desktop/src/features/home/lib/inbox.ts::getInboxConversationId/buildInboxItems`。
- C：`desktop/src/features/home/ui/InboxFilterMenu.tsx::INBOX_FILTER_OPTIONS/InboxFilterMenu`。
- D：`desktop/src/features/home/ui/HomeView.tsx::HomeView`。
- E：`desktop/src/features/home/ui/InboxListPane.tsx::InboxListPane`。
- F：`desktop/src/features/home/ui/ProjectInboxDetailPane.tsx::ProjectInboxDetailPane`。
- G：`desktop/src/features/projects/projectEnumeration.ts::enumerateProjectEvents`。
- H：`desktop/src/features/projects/projectWorkItems.ts::fetchProjectsWorkItems`。
- I：`desktop/src/features/projects/projectIssues.mjs::projectIssueEventsToIssues`，及
  `desktop/src/features/projects/projectIssues.d.mts::ProjectIssue`。
- J：`desktop/src/features/projects/projectPullRequests.mjs::projectPullRequestEventsToPullRequests`，及
  `desktop/src/features/projects/projectPullRequests.d.mts::ProjectPullRequest`。
- K：`desktop/src/features/projects/projectTaskCategories.ts::PROJECT_TASK_CATEGORIES/projectTaskCategoryFromLabels`。
- L：`desktop/src/features/projects/ui/ProjectDetailSection.tsx::ProjectDetailSection`。
- M：`desktop/src/features/projects/ui/ProjectProfileIdentity.tsx::ProfileIdentityButton/ProfileAuthorName`。
- N：`desktop/src/features/projects/ui/ProjectFeedRow.tsx::ProjectFeedRow/ProjectFeedRowCluster`。
- O：`desktop/src/features/projects/ui/ProjectRichContent.tsx::ProjectRichContent`。
- P：`desktop/src/features/projects/ui/ProjectIssueCommentTimeline.tsx::ProjectIssueCommentTimeline`。
- Q：`desktop/src/features/projects/ui/ProjectDetailMeta.tsx::ProjectDetailMetaPills`。
- R：`desktop/src/features/projects/lib/projectsViewHelpers.ts::formatExactTimestamp`。
- S：`desktop/src/features/projects/ui/ProjectIssuesPanel.tsx::ProjectIssueDetail`。
- T：`desktop/src/features/projects/ui/ProjectCommitCopyButton.tsx::CopyTextButton`。
- U：`desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx::ProjectPullRequestDetail`。
- V：`desktop/src/features/projects/ui/PullRequestReviewersRow.tsx::PullRequestReviewersRow`。
- W：`desktop/src/features/projects/ui/PullRequestMetaRail.tsx::PullRequestMetaHeader`。
- X：`crates/buzz-relay/src/handlers/ingest.rs::is_global_only_kind`。

### 43 路径逐项对应

表内目标路径相对 `apps/`。共享迁移不等于整文件与官方逐字相同；原 JSX/算法
保留与必要 host/i18n 接缝分别说明。检查文件和追溯文件属于治理改造的证据，
不伪造它们在上游有同名实现。

| 目标路径 | 官方对应 | 分类及实际范围 |
|---|---|---|
| `contracts/api/projects_query_request.schema.json` | H、X | 已授权治理改造：原项目事件读链增两个封闭 view，非新产品实体 |
| `core/crates/platform-core/src/projects.rs` | H、X | 已授权治理改造：原 kind 集合映射现有 actor-bound Community 读取，前后准入与签名校验 |
| `core/crates/platform-core/src/user_state.rs` | A、B、X | 已授权治理改造：项目事件不冒充频道，复用原 Core CAS 读账本，不复制正文 |
| `client-kit/ts/platform/src/inbox.ts` | A、B | 共享迁移：原坐标/root 聚合与项目分类；消息级读位置适配现有合同 |
| `client-kit/ts/platform/src/react/inbox-surface.tsx` | C | 共享迁移：原 Project 筛选接实际数据；Needs action/Reminders 不生成空菜单 |
| `web-client/web/src/platform/ui/InboxPane.tsx` | D、E、F | 已授权治理改造：Web BFF/原读标记宿主，消费同一原详情；作者触发器仍缺失 |
| `web-client/web/src/platform/ui/PulsePane.tsx` | M、O、T | 已授权治理改造：复用既有资料/Markdown/clipboard host 接原只读详情，不另建资料权威 |
| `collaboration/desktop/src/features/platform/ProjectsScreen.tsx` | H、X | 已授权治理改造：本机 key 原 Relay 读链，封闭 view/坐标 guard |
| `collaboration/desktop/src/features/platform/PulseScreen.tsx` | M、O、T | 已授权治理改造：原 native host 接共享详情，未改原 signer/DM 准入 |
| `collaboration/desktop/src/features/home/ui/HomeView.tsx` | D、F、H | 共享迁移：现有 feed 接项目读取，详情复用 shared TS；不是第二套页面 |
| `collaboration/desktop/src/features/home/ui/InboxListPane.tsx` | E | 已授权治理改造：无频道项目不开放无消费者 Open-in-channel；原选择和读标记保留 |
| `collaboration/desktop/src/features/home/lib/inbox.ts` | B | 共享迁移：真实调用统一 conversation key，不丢项目 kind |
| `client-kit/ts/platform/src/react/projects/projectEnumeration.ts` | G | 共享迁移：原同秒边界排空提取供目录/项目复用，满桶拒绝保持 |
| `client-kit/ts/platform/src/react/projects/projectIssues.mjs` | I | 共享迁移：原 Issue reducer/可信 actor/状态历史语义保留，排序依赖内联来自原模块 |
| `client-kit/ts/platform/src/react/projects/projectIssues.d.mts` | I | 共享迁移：原声明改引用现有 PulseEvent，不手写第二业务协议 |
| `client-kit/ts/platform/src/react/projects/projectPullRequests.mjs` | J | 原样保留：固定原 PR reducer 文件；可信更新、review 决策和 commit 语义不重写 |
| `client-kit/ts/platform/src/react/projects/projectPullRequests.d.mts` | J | 共享迁移：原声明复用 shared 事件类型 |
| `client-kit/ts/platform/src/react/projects/projectTaskCategories.ts` | K | 原样保留：原封闭类别和解析函数；展示翻译来自同源词条 |
| `client-kit/ts/platform/src/react/projects/projectWorkItems.ts` | H、I、J | 已授权治理改造：同一 canonical reducer 消费分页授权结果，generation/取消/部分失败拒绝 |
| `client-kit/ts/platform/src/react/projects/ProjectDetailSection.tsx` | L | 共享迁移：原完整折叠 section，仅共享依赖路径适配 |
| `client-kit/ts/platform/src/react/projects/ProjectProfileIdentity.tsx` | M | 共享迁移：原详情作者身份 JSX 接既有 shared popover/avatar |
| `client-kit/ts/platform/src/react/projects/ProjectFeedRow.tsx` | N | 共享迁移：原 timeline/feed-row 结构及样式 |
| `client-kit/ts/platform/src/react/projects/ProjectRichContent.tsx` | O | 共享迁移：保留原正文外框，正文/tags 交现有宿主 Markdown，不复制 Core 正文 |
| `client-kit/ts/platform/src/react/projects/ProjectIssueCommentTimeline.tsx` | P | 共享迁移：原历史折叠/展开，文案同源；没有假评论提交 |
| `client-kit/ts/platform/src/react/projects/ProjectDetailMeta.tsx` | Q | 共享迁移：补原 pill 分支，既有 meta list 不另改布局 |
| `client-kit/ts/platform/src/react/projects/lib/projectsViewHelpers.ts` | R | 共享迁移：原精确日期消费者适配当前语言 |
| `client-kit/ts/platform/src/react/projects/ProjectIssueDetail.tsx` | S | 共享迁移：原任务正文/metadata/description/history 只读 JSX；原写分支缺失另列 |
| `client-kit/ts/platform/src/react/projects/ProjectCommitCopyButton.tsx` | T | 共享迁移：原复制控件、反馈样式；宿主拒绝明确报错 |
| `client-kit/ts/platform/src/react/projects/ProjectPullRequestDetail.tsx` | U | 共享迁移：原审阅正文/updates/commits/checks/review timeline 只读分支；Git 文件与原写仍缺 |
| `client-kit/ts/platform/src/react/projects/PullRequestReviewersRow.tsx` | V | 共享迁移：原 reviewers/decision 摘要展示分支；不开放未治理 picker/write |
| `client-kit/ts/platform/src/react/projects/PullRequestMetaHeader.tsx` | W | 共享迁移：原 branch/status/label header，源于 MetaRail 而非自画 header |
| `client-kit/ts/platform/src/react/projects/ProjectInboxDetail.tsx` | F | 共享迁移：原 Inbox 详情 frame/card，双端同一消费者；非完整项目深链实现 |
| `client-kit/ts/platform/src/react/projects/index.ts` | F、H | 共享迁移：只导出上述真实双端消费者 |
| `client-kit/ts/platform/src/i18n.ts` | C、F、P、S、U、V、W | 已授权治理改造：仅本批原可见文本中文/英文 62 行，排除原其他暂存修改 |
| `client-kit/dart/lib/shared/platform/platform_text.dart` | 同上 | 已授权治理改造：由同一 TS 词条原生成器投影，不代表 Mobile 新增项目页面 |
| `client-kit/ts/platform/test/project-inbox.test.tsx` | A、F、H、I、J | 已授权治理改造证据：实际 reducer/React 消费、scope 拒绝与取消，非上游同名测试 |
| `web-client/web/src/platform/ui/InboxPane.test.tsx` | D、E、F | 已授权治理改造证据：真实 Web 选择、完整正文、msg 读位置，不拿 DOM 通过当截图 |
| `client-kit/ts/contracts/test/roundtrip.test.ts` | H 的 typed query 接缝 | 已授权治理改造证据：原用例追加两个 view；TS 实际通过 |
| `core/crates/contracts/tests/roundtrip.rs` | 同上 | 已授权治理改造证据：精确枚举往返增量；后续复用独立 target，1/1、exit 0 |
| `worker/internal/contracts/roundtrip_test.go` | 同上 | 已授权治理改造证据：精确枚举往返增量；独立生成后原定向用例 1/1、exit 0 |
| `client-kit/dart/test/roundtrip_test.dart` | 同上 | 已授权治理改造证据：精确枚举往返增量；独立生成后原定向用例 1/1、exit 0 |
| `core/verify/inbox-project-read.md` | A–X | 已授权治理改造证据：权威、影响、失败与发布缺口；不是新规格 |
| `tools/traceability/collab.projects.yaml` | H、X | 已授权治理改造证据：既有 Projects 追溯项关联本回执，不新增注册表 |

同批追加的四侧生成路径仍属于上述 H 的 typed query 接缝，不是新增四个产品模块：

| 生成路径 | 分类及边界 |
|---|---|
| `core/crates/contracts/src/generated/contracts.rs` | 已授权治理改造：原生成器添加两种封闭 view；后续复用独立 target，定向往返 1/1、exit 0 |
| `worker/internal/contracts/generated/contracts.go` | 已授权治理改造：同一 schema 的 Go 映射；定向往返 1/1、exit 0，不包含 Cells 未提交字段 |
| `client-kit/ts/contracts/src/generated/contracts.ts` | 已授权治理改造：双宿主管理读取共用契约；定向往返 1/1、exit 0 |
| `client-kit/dart/lib/shared/contracts/generated/contracts.dart` | 已授权治理改造：同一 schema 的 Dart 映射；定向往返 1/1、exit 0，不代表 Mobile 新页面 |

### 仍属于缺失需恢复的完整范围

1. Web 项目通知行的原作者资料/头像触发器。Desktop 已消费原 shared Avatar/PopoverSurface；Web 的 MessageAuthor 查询要求真实 Workspace/Conversation 事件授权，不能用项目伪造该上下文。现有 PulsePane 把 host、目录、composer 与页面绑定，尚无可直接复用的纯资料宿主；没有为借上下文把整个 Inbox 包进 Pulse 页面，也没有造第二资料实现。
2. 原 `ProjectIssuesPanel.tsx::ProjectIssueDetail` 的任务分派、状态修改、评论写入；原 `ProjectPullRequestsPanel.tsx::ProjectPullRequestDetail`、`PullRequestReviewersRow.tsx::PullRequestReviewersRow` 的请求/决定/合并写接缝。候选不渲染无消费者动作，不据此将它们从交付目标删除。
3. 原 `desktop/src/features/projects/ui/ProjectPullRequestFilesChangedPanel.tsx::ProjectPullRequestFilesChangedPanel` 的 Git 文件差异、commit 文件导航、原 DiscussedInChannels 与 buzz:// 深链。只读正文不等价 Git 完整能力。
4. Inbox 的 Needs action/Reminders 与完整个人待办仍没有本批实现/验收；没有用 Temporal 状态卡片代替原 feed。

### 源码、操作与截图证据不能互换

候选窄验：共享组合 80/80、末版项目读链 7/7、Web Inbox 29/29、Core 项目 5/5、
原读标记 2/2 和 Clippy 退出 0；移除 bindingVersion guard 的反证 5/6 后还原通过。
这些是源码/实际检查证据，不是线上项目实例或 Windows 验收。

已部署截图仍仅属于 `9d718234b74b688d9b81816f9b67470d4fc80440`，buildId
`sha256:1fe5c137da245352680e90626a67aef906cd4bee1bb9b7964b2c080964c0653e`。
已打开的 `/volumes/data/kailo/tmp/web-main-9d71823-release.fddJRC/10-inbox-filter.png`
实际仍是五种筛选，`03-projects.png` 为无项目对象空态，`09-inbox.png` 为原会话/线程。
这些只能证明修复前缺口及已部署范围；本候选新增 Project 筛选、Issue/PR 详情、
项目作者操作和刷新/撤权均没有部署后截图。全量台账的历史 5314 路径统计不能
直接减去这 43 路径当“完成率”，没有逐页面/关键状态矩阵也不报虚假的未验收总数。

## 2026-10-12 回复完成的当前身份与详情归属

本批属于 `DD-75` 的既有 Web 发布接缝修复，不改变固定官方 Inbox 回复产品行为。
实际问题在 `InboxPane::onPublicationStateChange`：旧详情卸载后，晚到的回复成功
仍会清掉新详情的父级发布锁，晚到 UNKNOWN 也会回写选择并刷新。编辑已有归属
保护，回复却没有；现在两者复用同一个当前 principal/会话/workspace 的 owner。
退役 owner 不能发起发布，完成或异常只向原调用方返回，不改新详情或父级锁。
同 owner 的键盘/父级选择锁、UNKNOWN 中性状态和明确 `PublishRejected` 规则不变。
无新状态、契约、存储、迁移或第二权威；Desktop/Mobile 传输与原 UI 均未改动。

证据目录为 `/volumes/data/kailo/tmp/inbox-publication-owner.eDZq8v`。沿既有
Data SDK `kailo-inbox-forum-r5kqbx`（2 CPU/4 GiB、用户 1000:1000、无网络）
核对并发及压力后，原 Web `tsc --noEmit` 和 Inbox 40 项退出 0（`positive.log`）。
初次破坏验证中频道两个用例准确失败，私聊两个夹具依赖前序 mock，不能算有效
反证（`mutation.log`）；仅修正新用例自有夹具后，四个隔离用例退出 0
（`isolated-positive.log`）。私有副本只去掉回复完成的 owner 保护，四个均在父级
回写断言准确失败、退出 1（`mutation-isolated.log`）；精确还原并 `cmp` 正式源码
退出 0，原 40 项再次全部通过、退出 0（`final-restored.log`）。实现后独立复核
实际父级调用链和固定官方回复行为，未发现本批新增阻断。

这是源码与原消费者证据，不是浏览器、三人多 Agent、Windows 或发布验收。
已构建的 `54306bc7d4af23495a4c318427e025df6850df1c` Web 产物不含本修复，
本批未部署，未据此提高可用完成率，也不改变上面的完整原版缺项。
