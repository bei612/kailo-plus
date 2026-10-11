# 原线程 URL 历史恢复

## 权威、影响与四类差异

固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/hooks/useHistorySearchState.ts::useHistorySearchState`、
`desktop/src/features/channels/ui/useChannelPanelHistoryState.ts::useChannelPanelHistoryState`、
`desktop/src/features/channels/ui/ChannelScreen.tsx::ChannelScreen`、
`desktop/src/features/channels/ui/useChannelRouteTarget.ts::useChannelRouteTarget`，
以及 `desktop/src/features/channels/ui/useNavigationGuard.ts::useNavigationGuard`、
`desktop/src/features/messages/ui/DraftsPanel.tsx::openDraftEntry/sendDraftEntry`
是本批实际来源。用户固定原版一致性要求及 `.design/07` §4 的共源呈现边界
不允许 Web 只保留组件内线程选中态，丢失原 URL 刷新与前进后退行为。

1. 权威：线程正文及可见性仍由原受治理 Relay/BFF 查询决定；URL 只存原
   `thread` 引用。`useHistorySearchState` 的同事件 microtask 合并、未变化
   不推栈、replace 合并规则、保留无关 search 字段及 resetScroll=false
   原算法共享迁移；Native 原位置只保留既有 TanStack 适配。
2. 影响：共享包导出、Native 原 hook、Web `platformLocationSearch` 白名单、
   `usePlatformNavigation`、`PlatformApp` 两条频道/DM 真实宿主和 `ChannelPane`，
   以及 Inbox 草稿导航与既有 Forum/线程/Composer 实际消费者。
   宿主已有 Router 保持唯一导航权威，无新路由、依赖、wire schema 或数据库。
   原权限与 BFF 媒体、作者和线程查询不变。
3. 副作用：导航只保存 message/thread ID；不会写正文、身份、令牌、草稿内容或
   准入结果。页面内只保留选中消息 ID，实际行由当前 scope 的实时窗口和
   `useWorkspaceThread` 查询共同派生。刷新重新准入，不能从 history 恢复正文。
   普通历史操作不触发发布、重试副作用或新执行权威。原 Inbox 确认发送的
   草稿 key 只在当前会话 scope 的 history state 中传递，不进入 URL；先以
   replace 消费 send 标记，再由当前 Composer owner/sendRef 进入原持久化
   sendIntent/准入链。已有 UNKNOWN 意图不自动重派；等待导航消费期间也在
   执行前重读当前 intent，不能用等待前的空值越过未知结果边界。
4. 边界：冷线程先等待现有查询，空/无权限/中断沿原错误状态；未知 thread
   不是创建线程的请求。URL 更换重新读取，旧 scope 窗口原同步隔离不变。
   普通打开/关闭清除原 message 定位并合并为一条导航；真实深链解析 replace
   当前条目，不多塞一条 Back。线程编辑使用原共享离开 guard 和既有
   `buzz.finishThreadEdit` 提示，不另造确认弹窗或草稿权威；撤权不由导航阻止。
   暖 root/reply 在窗口中也不能覆盖线程读取的 pending/拒绝/中断/错误；
   普通 metadata 后台刷新不被当作撤权，保留已准入线程与编辑 guard。

此前 Web 内嵌 DraftEditor 并非固定上游原打开语义。本批删除该旧路径，
打开及确认发送都经 InboxPane.onOpen 到原频道/会话导航；没有新增本地
草稿 history 或第二频道宿主。原 root/reply 及 native DM 草稿 key 保留，
实际读取与 Composer 仍逐 scope 准入。授权差异是 Browser 经 BFF、原路由
会话隔离，以及自动发送标记不写 URL；不复制草稿正文或生成假成功。

分类：原批处理/锚定引用算法为“原样保留”；原 hook 为“共享迁移”；
Web BFF 新鲜读取和已有 Router 传输接线为“已授权宿主/治理改造”；此前
Web 打开/关闭线程不记 URL 为“缺失需恢复”，本批源码已补，不等于浏览器
全状态验收。Profile URL、Native 完整全路由 guard、完整 ChannelHome、
ProjectDetail 与 Agent Transcript 不由此批证明恢复。

## 独立输入与实际证据

- 私有 `/volumes/data/kailo/tmp/ui-thread-history.tn6U43/{base,apps}`；
  前像顺接上一批 `a5493c3d6294109ec0c1046b5302869e7c5d6b0e5e672ac34064e052cd69f060`
  的线程布局候选，其他前像取当时正式文件。主线程已将 9716 源码检查点精确
  合入正式 apps；本代理后续纠正仅在私有输入，未操作公共 index。
- 原 `kailo-agent-receipt-xvkujx` 执行前只有 sleep，实际 4 CPU/8 GiB、
  memory+swap 同额，宿主 available 22 GiB。主线程既有 buildctl/Cargo 仍在
  运行；本批不触碰 Rust cache、不启动镜像或全量检查。复用两份完整私有
  UI 输入及原 `file:` 安装副本，首轮八源同步后逐文件 cmp 0。
- 作业 64045 串行原共享/Web/Native 类型与原
  `src/app/platform-navigation.test.tsx`、`src/platform/ui/ChannelPane.test.tsx`；
  原件 `/volumes/data/kailo/tmp/ui-thread-history.tn6U43/validation.log`。
  实际终态 exit 2：共享类型 0；Web 类型报告新增用例缺 created_at，以及
  InboxDrafts/ChannelRead 调用未接四个必需导航字段。Native/DOM 未启动。
  随后修正真实调用及检查事件结构，保留原失败，不回填通过。最终 16 源
  尚待集中验证；没有修改 timeout、pool 或业务断言求绿。
- 16 源最初审阅版本 `ba40b4a3a2eb08b4b47f9166cc5e4eb9ad5297d42e7bd9369026e9d5617bafe6`
  后修正三个新事件夹具的真实 channelId/category 字段；主线程集成版
  `owned-source-final.patch` 为 `9716c1a589586d11bfa6ec3705ff95cf84abf12d4615a386538c2f8c4d37f0a9`。
  两份受限 SDK 输入与 file: 包副本逐文件 cmp 0。作业 86938 原命令
  依次为共享/Web/Native 的 `node node_modules/typescript/bin/tsc --noEmit`；
  日志 `validation-final-types.log`。实际共享退出 0、Web 因上述三夹具缺字段
  退出 2，Native 未开始。修正后 55618 的 `validation-final-consumers.log`
  实际 Web/Native 类型均 0；六文件 DOM 138 通过、36 失败，终态 1。
  26 项为原 react-query 全 mock 未包含新的真实 useQueries 消费；三个录音
  夹具错误继承 Navigator.platform WebIDL getter；另有旧作者展示断言、
  未推进真实 Motion 退出帧的检查问题，不能将它们归为 I/O 启动失败。
- 实际交互还抓到两项生产错误：split/focus 包装与 AuxiliaryPanel 根节点切换
  卸载 Composer，以及 native DM binding ID 被误当成消息 h。本批按原 class/
  尺寸/ARIA 保留稳定面板及编辑器实例；共享 shell 的 split 语义根统一为
  aside 是保留真实 UNKNOWN 写意图所需的宿主差异，非新增布局。原 resize、
  overlay、宽度 preference 和 focus 100% 均保留。既有 MessageAuthorProfile、
  ProfilePanel、Members、线程/骨架和 Native 宿主仍使用原 API；源码样式检索
  未发现依赖 split 根 div 标签的 CSS 选择器，视觉仍须候选截图核验。
- useWorkspaceThread 全部三生产调用（ChannelPane、ChannelThreadPane、
  InboxThreadPane）传入可信 ConversationView.channelId，消息/编辑/反应及
  full-channel bounds 用其校验，缓存键包含该事实；BFF/stream 仍使用原绑定
  ID。缺 native channel 即拒绝，不从事件 h 或 displayName 推断；更换频道
  不复用暖行。原 Back 检查改为真实 browser history/popstate：锁定依赖的
  createMemoryHistory 只处理 PUSH/REPLACE blocker，不能代替真实 POP 验收。
- 当前纠正完整补丁 `owned-source-fixed.patch` SHA-256
  `3eb10ecfd41c6866a4796ea119e30b3722e58e2e97d8228b9c3ab9ca6ba2601d`，
  20 源 +657/-265；对已集成 9716 的独立 `owned-source-post9716.patch`
  为 `06e8a65bb63b9c49c6575b0fa32533ee4fdc7a6ac98a7015bc411973f4642fc8`，
  11 路径 +76/-53，正式 apply --check 0。作业 46841 使用同一原 SDK，
  在 Cells 小 Node 作业终态释放后启动，预检仅 sleep/4 CPU/8 GiB、宿主
  available 21 GiB、memory PSI avg10=0；`validation-fixed-consumers.log`
  实际三侧原 tsc 全部 exit 0；六文件 DOM 44 通过、8 失败，另三文件
  worker 启动超时/0 用例，终态 exit 1。navigation 18/18、InboxDrafts 8/8；
  ChannelPane 18 通过/8 失败。ChannelRead、Composer、ChannelThreadPane
  未执行，不能据此宣称 focus 100%、同 Composer/UNKNOWN 与 native DM
  最终交互已通过。主线程已精确合入 06e8，未改这轮失败日志。
- ChannelPane 实际失败进一步定位：AnimatePresence 保留退出节点，使读取拒绝、
  中断与撤权后仍可见旧线程；正常关闭检查也误要求原动画同步消失。
  本批以同一 threadAdmissionAvailable 控制消息选择及 presence owner。
  安全不可用时立即移除 owner 并调用既有 markExitComplete 清除 coverage；
  正常关闭仍走原退出动画。否则 owner 消失无法回调而遗留 inert。没有新增
  授权状态或降低准入。新用例实际覆盖聚焦线程、拒绝、清遮挡、重新准入及再次打开。
  DM 冷查询夹具补真实 snapshot/live；Agent 目录夹具更换真实查询结果对象，
  不以原地改数组欺骗 memo；正常关闭等待原实际退出，不提高 timeout。
- 33762 的 `validation-presence-admission.log` 实际 26/26、exit 0，仅覆盖
  最初立即卸载修正。追加 coverage 检查后 92184 的
  `validation-presence-final.log` 为 27 通过/1 失败：夹具向已 terminal 的
  scope-revoked 旧订阅投递 snapshot，原消费正确拒绝。修正为原 scope effect
  离开/返回建立新订阅，不修改生产拒绝规则；15503 的
  `validation-presence-readmission.log` 最终 28/28、exit 0。
  对 formal 已合 0405bf 的检查增量为 `presence-readmission-fixture.patch`，
  SHA-256 `0287854043cf9a8ca75ffcb2078d7cce01b6ab4420b7606a0039321af7d73c3f`。
- 43242 在同一私有受限输入中真实删除 coverage 清理 effect，原
  `node node_modules/vitest/vitest.mjs run src/platform/ui/ChannelPane.test.tsx -t "clears original focus coverage"`
  实际 2 项均失败（inert 残留）、exit 1，26 项按显式筛选未运行；日志
  `validation-presence-negative.log`。生产源随后按原字节恢复，cmp exit 0；
  10920 原同文件完整还原复验实际 28/28、exit 0（8.51 秒），日志
  `validation-presence-restored.log`。正式源不曾变异；SDK 已释放。
  上述日志全部位于 `/volumes/data/kailo/tmp/ui-thread-history.tn6U43/`。
- 本次三侧类型输入含既有 `dm.verifyPublicKey` TS 同源词条及 Dart 投影。
  主候选 77e018 一度缺该 TS 词条，不能用此类型结果覆盖缺依赖的候选；
  该词条来自先前原 SelectedRecipientChip 完整公钥 aria 文案恢复，并非本批
  新需求。用户暂存的两条 Projects 词条不属于该缺口，不得顺带收录。
- 本批没有新产物、部署或候选截图。线上旧 build-info `9e1bd303…` 不含本批；
  主线程统一安排匹配候选的原 Web 产物和正常 SSO 两布局/历史操作截图。
  未建立裸 Vite+BFF 旁路，Web 截图也不替代 Windows 安装验收。
