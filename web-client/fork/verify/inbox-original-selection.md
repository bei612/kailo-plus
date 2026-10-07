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
| Projects | 缺失需恢复；原 `projectInbox.ts` 的仓库 root/Review/Task 聚合未接到当前 Inbox；Projects 公告页不等价 |
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
