# 原版 DM 未读溢出呈现独立恢复记录

本批在 `/volumes/data/kailo/tmp/ui-dm-unread.LopLWa/apps` 实现；修改前逐文件字节保存在同根 `base`。主线程交叉复核后已用 apply_patch 将精确增量接回正式工作树，未暂存或提交；主线程 78 文件候选 `db8034ca73c007cf7ea84fe67481ea793e68ae30` 不含本批。

## 权威与完整原消费者

固定 Buzz `779af8886caae1317b4de962082429867ab61503`：

- `desktop/src/features/sidebar/ui/MoreUnreadButton.tsx::{canPreviewUnreadDm,visibleUnreadDmPreviews,unreadDmAccessibleLabel,preferredUnreadTarget,MoreUnreadButton}`：原 1v1 门禁、最多三个头像、完整无障碍句、DM 优先滚动及 pill 内部布局。
- `desktop/src/features/sidebar/lib/useSidebarUnreadOverflow.ts::{hasHighPriorityOverflow,useSidebarUnreadOverflow}`：消息与线程目的地去重、DM 高优先强调、下方未读目的地列表。
- `desktop/src/features/sidebar/ui/AppSidebar.tsx::AppSidebar`：下方预览使用原滚动顺序，上方不另加头像；下方点击原 `scrollToChannel`，不是另开私聊或写已读。

`.design/01` REQ-24 要求完整原版及 Web/Desktop 同源；`.design/03` §2 的 ConversationBuzzBinding/CollaborationUserState、`.design/09`「原生私聊与多设备映射」及用户状态段固定 HUMAN 参与者、Core 已读权威和 Relay 隐藏权威。人数使用已准入 Principal 集合，不把同一人的设备公钥计作多人。

## 影响面、写读关系和边界

本批复用共享 `ConversationList` 已有 ACTIVE 当前参与者集合、已读投影、授权 Inbox 事件去重和 Relay hidden 结果；行与溢出按钮使用同一份 unreadCounts。只把当前可见行的只读呈现投影交给宿主，不新增订阅、存储、已读 writer、身份目录或合同。

Web `ConversationSidebar` 原 BFF 查询与 Native `DesktopConversations` 原 Relay feed 继续各自读取；正在刷新时不给旧事件生成新的 DM 溢出投影。两个宿主消费共享 `useConversationUnreadProjection` 和原 `useSidebarUnreadOverflow`；会话身份切换同步屏蔽旧投影、拒绝迟到旧回调，并按原 scope 事实重挂 DM 目录消费者。

源码范围为 shared MoreUnreadButton、useSidebarUnreadOverflow、conversation-list；Web PlatformApp/ConversationSidebar；Native AppSidebar；原 sidebar-unread-overflow/conversation-sidebar 检查；同源 i18n 和生成 Dart。现有公共暂存内容不变，不涉及数据库格式或四语言 wire 契约。

空/隐藏/禁用/移除参与者的行不产生溢出预览；读状态 UNKNOWN、加载失败或目录尚未确认不伪造姓名或成功。群聊参与者和无法解析的目录不进入原单人头像预览；仍可作为原 DM 未读滚动目的地。重复消息沿原列表去重；同目的地重复 DOM 沿原 observer 去重。点击仅滚动，无新外部副作用、重试或额度预留。原六类错误的显示/重试保持原消费者处理，新增投影不把 UNKNOWN 转成已读或成功。

初批 ConversationParticipant 合同只提供真实 HUMAN 姓名和公钥，没有头像 URL、Agent 或 presence 事实，因此当时预览的 avatarUrl 为 null，使用原 UserAvatar 姓名 fallback。后续同批已沿既有已授权消息/profile 读链补上头像宿主，实际范围和验证结果见下节；仍不从姓名猜身份或推断在线状态。

## 实际证据与四类差异

已实现后补入原两个检查文件的消费者场景：实际 read CAS 后移除预览、UNKNOWN 清空、移除参与者/禁用/隐藏、scope 切换与迟到回调、原 1v1 门禁/三头像限制、中文完整 aria、DM 优先滚动。这些用例尚未执行；未执行生产变异/还原，不能宣称交互通过。

原受限 SDK `kailo-agent-receipt-xvkujx` 预检仅 sleep，4 CPU/8 GiB/同额 memory+swap，宿主 available 23 GiB；只执行 `python3 tools/gen-platform-i18n.py`，原句柄 21480 exit 0。真实输出为 `Generated client-kit/dart/lib/shared/platform/reason_text.dart` 和 `Generated client-kit/dart/lib/shared/platform/platform_text.dart`；reason_text 与基线 cmp 0，platform_text 仅本批一个 key/五行新增。日志 `/volumes/data/kailo/tmp/ui-dm-unread.LopLWa/i18n-generate.log`，SHA256 `0efc2ee6646642b145da315d9f7d58ef62d3c6ae7055cc0b2601e25e1b8ddffd`。

10 源路径精确补丁 `owned-source.patch`，+268/-22，SHA256 `0b9604ea535b7d4a21c25bc0c48830293fd996e1ee1bfb94fb3737c1d64d48be`；正式树 `git apply --check --whitespace=error` exit 0。生成器及两份合同仅为私有生成输入，不属于该补丁。公共 index SHA256 仍为 `7bd5fb04a69f8f3eaba9c8d893d882f7cc808589b4e56157f6e386765234d57e`。

原样保留：既有滚动观察器、UnreadPill、UserAvatar；共享迁移：固定原按钮分支/目标选择和两端消费；已授权治理改造：Core/Relay 已准入投影、Principal 人数、scope 隔离及中英同源；缺失需恢复/未验证：真实头像资料消费、候选页面视觉、类型/DOM/负向还原、Windows 设备。未启动新编译、类型、DOM、镜像或部署，也没有将旧部署 17 张截图当成本批验收。

## 同批真实头像及删除证据收口（2026-10-10）

原 ConversationParticipant→唯一另一 HUMAN 公钥→当前已授权消息的关联现在由原 ConversationList 消费。必须是原 1v1 集合、排除自己及任何其他 Principal 的重复公钥，消息属于当前会话；没有此证明时保留原 UserAvatar fallback，不额外抓取历史。预览投影只增加现有会话/事件/公钥引用，不新增 API、身份或 profile 缓存权威。Web 用既有 MessageAuthorAvatar→conversationMessageAuthorProfile；Native 用既有 useUserProfileQuery 的社区/设备 scope 与 rewriteRelayUrl。UserAvatar 的尺寸、形状、三头像堆叠、动画能力及无障碍标签不改；头像真实网络/动画不以 jsdom Image 替身证明。

Web 原 loadConversationSidebarActivity 在从窗口选择未读和头像证明前，现按固定上游 `desktop/src/features/messages/lib/formatTimelineMessages.ts::{getDeletionTargets,formatTimelineMessages}` 折叠 kind 5/9005。不是任意 e 引用：页面先经过 inboxWindowEvents/inboxReactionEvents 的 shape/kind/scope 校验；Core `verify_message_page` 验签、唯一 h 和两跳 auxiliary 关联；Relay `validate_standard_deletion_event` 校验有效作者或 Agent owner，`validate_admin_event` 的 9005 校验同频道目标及作者/owner/admin，ingest 要求恰一个 e/a。客户端不再造公钥相等授权，以免拒绝合法代署名或 owner 删除。普通 reaction 不删除消息，删除 reaction 不删除其指向的消息，错 scope 整页拒绝；消息证明撤回后旧头像消费者卸载，scope 变化不沿用前次结果。

原 SDK `kailo-agent-receipt-xvkujx` 4 CPU/8 GiB/同额 memory+swap 复用原缓存和已纠正 file: 实体包布局。Cells 正/负/还原作业结束且容器仅 sleep 后预检，available 22 GiB、IO full avg10 7.42，才启动原串行 69408；未新建容器/镜像。快照 `/evidence/agent-activity-native.Lkr7rT/apps` 冻结正式三批和本批头像增量，Native 使用 `/evidence/workflow-description-next.IPHHqc/apps` 同源副本，选定八源 cmp 0。

69408 实际结果：shared `tsc --noEmit` 与 `tsc --noEmit -p tsconfig.test.json` 均 0；原 sidebar-unread-overflow/conversation-sidebar 两文件 20/20；原 workflow-channel/workflow-form-canvas/agent-library 三文件 51/51；Web 三文件实际 57 通过/6 失败，Web 与 Native `tsc --noEmit` 均 0，总退出 1。日志 `dm-avatar-validation.log` SHA256 `1bdc731c8d205b693474aae851971a2de5f530d2147dc9ecea3a20369210d0f8`，位于本记录私有根。原 UserAvatar act 警告保留，不写成无警告通过。

六失败逐项处理：DM Image 检查缺少本文件既有 loadedImages 投递；三条姓名检查把缓存请求结束或 invalidation 发起误作 observer 已渲染，现等待原确切 DOM 期望；两条连续消息检查仍禁止 profile 读取，与统一 message.author/回复/video 的逐事件授权消费不符，现验证每事件一次，保留无头像、布局及真实打开断言。未改产品姓名/头像逻辑、期望文字、timeout/pool。新增删除折叠及这些检查修正没有热改 69408。

最终 Web 四文件（ConversationSidebar、MessageAuthorProfile、ChannelThreadPane、InboxThreadPane）原命令 46083：DOM 退出 1，120.39s、0 用例/4 worker 启动超时，transform/setup/import/tests/environment 全 0；后接 Web 类型退出 0。日志 `web-final-validation.log`。此失败不证明修正通过或业务失败，未再次重试 Web，也未把未执行的删除折叠反证记为完成。12 源最终精确增量 `avatar-final-source.patch` +144/-22、SHA256 `9709065ecce921ddaab521e511c8e2e8fdefe5d2e90e6c0a8fd0a45b7d749383`，formal apply-check 0；尚在私有候选等待主线整合，不混入原冻结 78 文件候选。

四类账更新：原 UserAvatar/UnreadPill/observer 原样保留；原溢出显示及实际共源消费者为共享迁移；已授权消息/profile 和双宿主传输、Principal 人数为逐项治理适配；无合法已读消息证明的头像仍 fallback，Web 最终四文件 DOM/删除折叠反证、候选浏览器截图及 Windows 设备仍未验收。旧 4c099 部署 17 图不证明这一候选，也不声称完整还原。

实现后真实反证 30542 只改 SDK 私有生产源，不改断言：禁用 MoreUnreadButton 的 renderAvatar；恢复 InstallationIdentityCard 的 Agent UUID；跨频道重置 approvalPolicy；延时 Input 改 range。原五文件命令实际运行 sidebar 8 和 agent-library 14：20 通过/2 失败，分别准确抓到头像宿主未调用和卡片 UUID 泄漏；另 conversation-sidebar/workflow-channel/workflow-form-canvas 三文件 worker 启动失败，不能声称其变异已被捕获。退出 1，99.72s。三个生产文件用 apply_patch 原字节还原，逐一 cmp 0；仅复验实际运行的两文件 49671，22/22、2.65s、exit 0，停止重试其余启动失败文件。

完整原命令：shared 目录 `node_modules/.bin/vitest run test/sidebar-unread-overflow.test.tsx test/conversation-sidebar.test.tsx`，成功后 `node_modules/.bin/vitest run test/workflow-channel.test.tsx test/workflow-form-canvas.test.tsx test/agent-library.test.tsx`；Web 目录 `node_modules/.bin/vitest run src/platform/ui/MessageAuthorProfile.test.tsx src/platform/ui/ChannelThreadPane.test.tsx src/platform/ui/InboxThreadPane.test.tsx`，最终轮额外包含 `src/platform/ui/ConversationSidebar.test.tsx`。反证为上述 shared 五文件一次执行；还原仅 `node_modules/.bin/vitest run test/sidebar-unread-overflow.test.tsx test/agent-library.test.tsx`。均原配置及 `NODE_OPTIONS=--max-old-space-size=3072`，未改超时/池。

最终日志 SHA256：`web-final-validation.log` 为 `645578439f3cc1bbf5e2674903270396f863aa4d0bcae1c3ffe2bb7463964e9e`；`shared-production-negative.log` 为 `38f5b6d72eea2e1dc44c5b97058a69e2cc4688232546beea7cb5f361466d0450`；`shared-production-restored.log` 为 `ed77bb7b5c8ae798e6444e976c762d1feb2063f2616ec38998622da0af01a9c8`。均位于 `/volumes/data/kailo/tmp/ui-dm-unread.LopLWa`。这些是局部消费者证据，不等于全量检查通过、提交、部署或新页面截图。

主线随后核对上述源补丁摘要，将头像最终增量与五份回执合回 `apps` 正式工作树，
并将 DM 原增量和最终增量纳入同一私有提交候选；不另开分支或 worktree。
该时点候选相对 `c442f2bb6e5c9e4db624057fe756272574a807f2` 为 98 路径，
选定候选的 `git diff --cached --check` 退出 0；公共暂存补丁摘要仍为
`78b0a81feb58b3a0549ff72398c01fe446aed7a53ef16357f7e75ed372894e71`。
这是源码集成，不改变上述 Web 未验收、尚未提交或部署的结论。
