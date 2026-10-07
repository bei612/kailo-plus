# Inbox 原版私聊分组与已读恢复

## 权威、差异和影响

对应 `REQ-24`、`DD-40`、`DD-53`、`DD-74`。固定 Buzz 提交为
`779af8886caae1317b4de962082429867ab61503`，只读 `git show` 重新核验：

| 固定源码路径与符号 | 本批差异分类与消费 |
|---|---|
| `desktop/src/features/home/lib/inbox.ts::getInboxConversationId` | 共享迁移：DM 按 `dm:channelId` 合并，不按 NIP-10 根拆成多行 |
| `desktop/src/features/home/lib/inbox.ts::buildInboxItems` | 共享迁移：DM 全组消费频道已读位置，最早未读消息为代表；线程原逻辑保持 |
| `desktop/src/features/home/lib/inbox.ts::getInboxTypeLabel` | 原标签恢复；共享中文/英文为授权差异，不显示公共频道标签 |
| `desktop/src/features/home/lib/inboxViewHelpers.ts::matchesInboxAllView` | 共享迁移：普通 DM 属于 All，不要求附带提及或回复 |

动手前四步结论：

1. 原版已有以上行为，当前共享实现漏掉 DM 分支；不是创建新页面或新筛选器。
2. 写方为 BFF 会话窗口、Desktop 已准入 feed，读方为共享聚合、双端 Inbox
   列表及标记已读。`channelType` 由真实目录解析，不信任正文或模型声明；
   Web 重新核对成员目录后才保留行。Core `readContexts` 仍是唯一已读权威。
   不改变合同、数据库或 Relay 事件格式；无需数据迁移。
3. 只恢复读取、分组和既有 CAS 已读写入，不产生聊天发送、安装或外部副作用。
   详情继续传真实根事件 ID，`dm:channelId` 仅用于列表身份。未知授权和读取
   失败沿既有失败状态，不因隐藏会话重新创建 Conversation。
4. 同事件 mention/activity 去重；跨频道同根隔离；DM 顶层/回复同一频道游标；
   标已读取最大时间，标未读取最小时间减一。成员撤销期间的缓存按既有刷新
   fence 清除，写入仍由 Core 重做权限和 CAS。没有新增状态或错误分类。

本批仍不覆盖 Desktop 完整普通 DM feed、双端原版 `fullChannel` 详情，以及
Project/Needs-action/Reminders 三类 Inbox 数据源。它们是缺失需恢复，不能因
本批分组通过而写成 Inbox 完整还原。既有全量差异清单不能替代本批后的全量
逐路径分类，当前不声明 100% 一致。

## 实际验证

基准 main `4393367c0219aee57f6d07afe8bc8609e2b1f9e8`。沿既有
`kailo-agent-receipt-xvkujx` 检查容器，回读 4 CPU、8 GiB memory/swap、
1000:1000；输入和依赖复用 Data 缓存，没有下载依赖、重建镜像或部署。

- 共享 `tsc --noEmit`、`tsc --noEmit -p tsconfig.test.json` 退出 0；
  `vitest run test/inbox.test.tsx`：16 passed。
- Web `tsc --noEmit` 退出 0；
  `vitest run src/platform/ui/InboxPane.test.tsx src/platform/ui/InboxThreadPane.test.tsx`：
  22 passed。覆盖普通/提及 DM 一行、真实频道 read command、隐藏会话恢复。
- Desktop `tsc --noEmit` 退出 0；
  `node --import ./test-loader.mjs --experimental-strip-types --test src/features/home/lib/inbox.test.mjs src/features/home/lib/inboxViewHelpers.test.mjs`：
  29 passed。共享/native 共用聚合消费者，不新增 Web 专属聚合实现。
- 首次宿主类型检查因 SDK 中 file 依赖包仍为旧副本，以及通知检查夹具使用
  字符串代替合同枚举而失败；同步正式输入并修正夹具后通过，未放宽生产类型。
- 私有 SDK 删除 DM 合并分支：1 failed / 15 passed，退出 1；私有 Web
  错误排除普通 DM：2 failed / 12 passed，退出 1。两处已还原，与正式输入
  `cmp` 退出 0。再次串行运行上述 16 + 22 + 29 项全部通过，退出 0。
- 共享词条批量生成 Dart，`tools/gen-platform-i18n.py --check` 退出 0。

变异日志位于 Data 下
`codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/inbox-dm-{shared,web}-mutation.log`；
恢复日志为 `/volumes/data/kailo/tmp/settings-scale-20261007.VXUSoG/inbox-dm-restored.log`。
第三方异步组件的 act 提示保留，没有屏蔽失败。

本批尚未部署。playwright-cli 查看线上旧版本通知页并打开截图，确实只有
Mention/Thread 两行，没有本批 DM 行；截图
`/volumes/data/kailo/tmp/buzz-conditions-release-20261007.rjEksd/notifications-pre-batch-20261007.png`
只记录发布前现状，不充当新代码验收。随后刷新 Inbox 时会话返回 SSO 登录页，
没有把缓存页面或登录页算成 Inbox 验收。新版本全页面截图、Windows/Mobile
实机、真实多人 DM 与全量 `check.sh --full` 仍无本批通过证据。

集中收口实际尝试 `TMPDIR=/volumes/data/kailo/tmp CHECK_CPUS=4 CHECK_MEMORY=8g
CHECK_NETWORK=host CHECK_CACHE_ROOT=/volumes/data/kailo/check-cache ./tools/check.sh --full`。
源码导出期间 Data 由约 3.4 GiB 降至约 320 MiB，主动终止本次 tar 导出，
命令退出 143，日志末行为 `Terminated`，尚未进入全局检查容器。原入口退出
清理仅删除本次临时导出，空间恢复约 3.4 GiB；未删除用户数据或共享缓存。
日志为 `/volumes/data/kailo/tmp/settings-scale-20261007.VXUSoG/restoration-batch-full.log`。
本次全量不是通过；发布继续受阻，阶段源码提交不作为发布验收。
