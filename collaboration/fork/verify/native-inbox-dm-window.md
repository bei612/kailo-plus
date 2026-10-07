# Native Inbox：普通 DM 来源与 fullChannel 详情

本批只恢复原版 Inbox 的 DM 数据来源、会话窗口与辅助事件闭包，不声明完整 Inbox、Windows 实机或生产验收完成。未运行打包、发布或全量检查。

## 固定来源与差异分类

上游为 `/volumes/kailo/.references/buzz`，commit `779af8886caae1317b4de962082429867ab61503`，只读核对：

- `desktop/src/features/home/ui/HomeScreen.tsx::HomeScreen`：原版把 `homeFeedQuery.data.feed.activity` 与 `threadActivityFeedItems` 合并；Kailo 原来只保留后者。本批恢复原合并，读失败时不显示旧 feed。
- `desktop/src/features/home/useInboxThreadContext.ts::useInboxThreadContext`：原版 `fullChannel` 路径合并已选事件与整个频道的内容行、不执行线程限定查询；本批恢复该分支和原版 channel loading/error 语义。旧已选事件不因离开最新窗口而丢失。
- 同文件 `fetchStructuralEvents`：原版结构辅助事件采用两跳，避免撤回编辑后又显示编辑内容；本批沿既有 React Query 辅助查询补齐结构事件与删除闭包，不创建另一套事件权威。
- `desktop/src/shared/api/relayChannelFilters.ts::buildChannelStructuralAuxFilter`：恢复原版编辑/删除种类；授权差异是保留 Kailo 的 `#h` 过滤，让 Relay 校验目标推导频道。反应读取仍走既有过滤器，原版 `refreshReactions` 接回现有真实反应消费者。
- `desktop/src/features/home/ui/HomeView.tsx::HomeView`：保留原版 `latchedDefaultParentId`，没有把 fullChannel 的默认回复偷偷改成顶层发送。隐藏 DM 使用已经准入并填充的同一频道缓存，不伪造 Channel 或额外开放读取路径。
- `desktop/src-tauri/src/commands/messages.rs::get_feed`：固定原版也以 `Vec::new()` 初始化 activity，并非现成完整 DM 冷数据源。新增 `nativeDmFeed.ts::loadNativeDmFeed` 是明确授权的治理适配：Core 的现有 Conversation 目录决定准入，现有 native `get_channel_window` 提供有界正文。没有声称直接复制了不存在的原版冷数据源。

## 动手前四步结论

1. 权威：REQ-24、`.design/03` 的 ConversationBuzzBinding 与 CollaborationUserState，以及既有 DD-53/74/75/77/79/80。DM 正文在 Relay，已读仍由现有 Core CAS；没有 schema、迁移或新增权限实体。
2. 影响：`useHomeFeedQuery` 的唯一现有刷新周期增加 DM 窗口读取，`HomeScreen` 消费 activity，`HomeView` 与 `useInboxThreadContext` 消费同一频道缓存。Web 由主线另行恢复，不改共享已读合同或 Rust 本地未读计数。
3. 副作用：每个窗口绑定当前 Relay URL 与本机公钥；签名、频道与 own-pubkeys 校验；全部窗口读取完后再次核对 Core 会话和身份，随后才返回供既有缓存消费者批量写入。读取异常不当作空成功，AbortSignal 失效不提交结果。
4. 边界：零会话返回空且不读 Relay；分页游标循环拒绝；逐会话有界串行读取；自身所有关联公钥不进入 incoming DM；跨频道或无效签名拒绝；读中撤权/取消拒绝整批结果；aux 失败保留不可用状态。无新写操作、重试副作用或结果不明状态。

## 实际验证

复用既有 `kailo-agent-receipt-xvkujx` SDK（4 CPU / 8 GiB，未新建镜像），目录 `/evidence/profile-settings-ortsoo.DRR20F/apps/collaboration/desktop`。

```text
./node_modules/.bin/tsc --noEmit
exit 0

node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/home/nativeDmFeed.test.mjs \
  src/features/home/useInboxThreadContext.test.mjs \
  src/features/home/lib/inbox.test.mjs \
  src/features/messages/lib/channelWindowResponse.test.mjs \
  src/features/messages/lib/formatTimelineMessages.test.mjs
tests 34 / pass 34 / fail 0 / exit 0
```

实现后新增六例：普通非 @/非线程 DM、排除自己、读后撤权、读中取消、跨频道结果、零会话，以及 fullChannel 已选消息合并/结构事件二跳/错误状态（相关条件在六例内组合验证）。最终输出保存在 `/volumes/data/kailo/tmp/settings-scale-20261007.VXUSoG/native-inbox-window-final.log`。

负向仅改私有 SDK：移除读后 Core 会话准入条件、禁用 fullChannel 对窗口消息的合并。相同六例实际报 `Missing expected rejection` 和 `Set(3) != Set(4)`，pass 4 / fail 2 / exit 1。两个变异已还原，与正式源码一致，集中 34 例复验通过。没有修改正式源码降低保护。

## 未计为完成

- 本批 DM 冷列表读取每个已准入会话的现有有界最新窗口，不声称扫描整个无限历史。
- 原版完整筛选与提醒/需操作来源、其他 Inbox 交互，以及 native 隐藏 DM 的完整回复/成员能力，不由本批窗口读取证明。
- Windows 安装包、设备交互、截图、部署与全量检查均未由本批执行；Node hook/类型检查不能代替这些证据。

交叉复核确认：`HomeView` 原有 `!feed` 早返回已经替换整个 Inbox/详情为不可用页，不存在由这批查证出的“feed 失败仍显示旧详情”问题。本批另外在既有 active latch 准入表达式使用 `admittedFeed`/Core 失败状态，使不可用期间不继续消费旧锚点发起 aux/profile 查询；不是新增 UI 状态。hook 检查同时验证清除选择后即使仍传入旧频道缓存，也返回空 context 且不再发 aux 请求。
