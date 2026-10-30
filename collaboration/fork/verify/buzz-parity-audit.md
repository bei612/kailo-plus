# Buzz 前端逐项一致性核对（Web + Desktop）

维护：r12 fork AR（续 fork AO 初稿）。原版 Buzz `779af8886caae1317b4de962082429867ab61503`（`.references/buzz/desktop/src`）；Kailo 源码基准 `feat/buzz-restore-r12` `89e51189d`（= main）。

本文件是仓库内副本，不含截图与逐文件“一致”行；完整清单与截图证据在 CI 节点 `~/kailo-acceptance/buzz-parity-audit/CHECKLIST.md`，截图在 `~/kailo-acceptance/buzz-parity-audit/shots/`。部署环境 `http://192.168.0.193:58090`（kailo-qa-2，只读，不发消息）：Web 镜像 `web-client@sha256:1680f7e3e8b5…`（2026-10-30T02:38Z 创建），Core 镜像 `core@sha256:c79ff7f6fa00…`（2026-10-30T04:17Z）。截图为该部署的当前状态；标“已修”的项在部署新版本后需用 `scripts/shots.mjs` 重拍确认。

## 判定口径

- **一致**：功能、信息密度与交互状态与原版相同。视觉按 DD-141 Kailo，不做像素比对。
- **缺失**：原版有、Kailo 没有。
- **不同**：按设计做了宿主或治理适配、设计排除、视觉由 DD-141 接管，或清单尚为“待定”。
- **已修**：核对时发现缺失或不同，已在 r12 分支修复，但部署版本尚未包含。
- 第 1 节是人工逐项核对（区分 Web 与 Desktop）。第 3 节逐文件清单只证明源码层承接，不能代替第 1 节；它把 Web 共用的源码也记为“一致”；第 1 节 Web 消息 Markdown 的复核结论见该节。

## 1. 聊天框与消息渲染（人工逐项）

| # | 项目 | 原版 | Kailo | Web | Desktop | 证据 / 修复 |
|---:|---|---|---|---|---|---|
| 1 | 消息行：头像、作者、时间、连续消息折叠 | `features/messages/ui/MessageRow.tsx` | client-kit `messages/MessageRowSurface.tsx` | 一致 | 一致 | shots/01-channel-view.png |
| 2 | 段落、粗体、斜体、删除线、行内代码 | `shared/ui/markdown.tsx` | Web `features/chat/ui/MessageContent.tsx`；Desktop `shared/ui/markdown.tsx` | 一致 | 一致 | shots/09-message-rich-markdown.png |
| 3 | 代码块：语法高亮、语言标签、复制 | `shared/ui/markdown/CodeBlock.tsx`、`SyntaxHighlightedCode` | client-kit `message-body.tsx`（shiki、复制按钮） | 一致 | 一致 | 代码核对 |
| 4 | 无序/有序列表：项目符号、编号、缩进 | `markdown.tsx` 的 `ul`/`ol`/`li`（`list-disc`、`pl-6`、marker 弱化色） | Web 消息渲染器展开共享的 `MESSAGE_BODY_COMPONENTS`（client-kit `message-body.tsx`），与 Desktop 同一组件：`ul`/`ol`/`li`（`list-disc`/`list-decimal`、`pl-6`、marker 弱化色） | 一致 | 一致 | 复核更正：代码与测试证明已渲染（`MessageContent.test.tsx`“renders the original block Markdown…”，CI 33/33 通过）；原判定只检索了 web-client，未计入共享组件 |
| 5 | 标题 h1–h6 字号层级 | `markdown.tsx` 的 `h1`…`h6` | Web 消息渲染器展开共享的 `MESSAGE_BODY_COMPONENTS`（client-kit `message-body.tsx`），与 Desktop 同一组件：`h1`–`h6` 字号层级 | 一致 | 一致 | 复核更正：代码与测试证明已渲染（`MessageContent.test.tsx`“renders the original block Markdown…”，CI 33/33 通过）；原判定只检索了 web-client，未计入共享组件 |
| 6 | 引用块：左边线、弱化色、斜体 | `markdown.tsx` 的 `blockquote` | Web 消息渲染器展开共享的 `MESSAGE_BODY_COMPONENTS`（client-kit `message-body.tsx`），与 Desktop 同一组件：`blockquote` 左边线、弱化色、斜体 | 一致 | 一致 | 复核更正：代码与测试证明已渲染（`MessageContent.test.tsx`“renders the original block Markdown…”，CI 33/33 通过）；原判定只检索了 web-client，未计入共享组件 |
| 7 | 表格：横向滚动容器、表头底色、单元格边线 | `markdown/MarkdownTable.tsx`、`th`/`td` | Web 消息渲染器展开共享的 `MESSAGE_BODY_COMPONENTS`（client-kit `message-body.tsx`），与 Desktop 同一组件：`MessageTable` 横向滚动、`th` 底色、`td` 边线 | 一致 | 一致 | 复核更正：代码与测试证明已渲染（`MessageContent.test.tsx`“renders the original block Markdown…”，CI 33/33 通过）；原判定只检索了 web-client，未计入共享组件 |
| 8 | 分隔线 | `markdown.tsx` 的 `hr` | Web 消息渲染器展开共享的 `MESSAGE_BODY_COMPONENTS`（client-kit `message-body.tsx`），与 Desktop 同一组件：`hr` | 一致 | 一致 | 复核更正：代码与测试证明已渲染（`MessageContent.test.tsx`“renders the original block Markdown…”，CI 33/33 通过）；原判定只检索了 web-client，未计入共享组件 |
| 9 | 任务列表复选框 | `markdown/MarkdownInput.tsx` | client-kit `messages/MarkdownInput.tsx`（原版迁入，状态标签中英文） | 已修 | 一致 | r12 `9e364d5c6`：GFM 任务项改为只读 Checkbox；测试同上 |
| 10 | 隐藏目标的链接：悬停显示真实地址；外链锚点 | `markdown/MaskedLinkTooltip.tsx`、`ExternalLinkAnchor.tsx` | client-kit `messages/MaskedLinkTooltip.tsx`、`maskedLink.ts`（原版迁入）；Web 外链经它包裹，Desktop 原生副本另有右键菜单 | 已修 | 一致 | r12 `9e364d5c6`：隐藏目标的链接悬停显示真实地址，裸链接与同址标签不加；测试“reveals a masked link destination…” |
| 11 | 已发送消息里的人员 @提及（chip、点开资料卡） | `markdown/MarkdownMention.tsx` | client-kit `MarkdownMentionChip.tsx`、`resolveMentionNames.ts` | 已修 | 已修 | 结构一致；视觉层 DD-141 把提及 chip 设为 brand-soft（Iris 50，与白底对比约 1.03，暗色字色接近正文），看起来“不高亮”。r12 `2cd0583df`/`93bc9e289`：新增 `mention`/`mention-text` 令牌（亮色 brand 200/300/800，暗色 brandDark 900/800/200，设计 20 §2.4 `fb0384551`/`6bf2304fd`），token 测试守住字色 ≥4.5、chip 与 surface/悬停行 ≥1.25 |
| 12 | 已发送消息里的 Agent @提及高亮 | 同上 | Web 提及名单原只含真人成员 | 已修 | 一致 | shots/04（修复前纯文本）；`3d7ab0bc5`，待部署重拍 |
| 13 | 输入框提及块：选中后高亮、Agent/真人图标 | `lib/mentionHighlightExtension.ts`、`composer.css` | client-kit 同名文件（共享编辑器） | 已修 | 已修 | 输入框编辑器根节点同样带 `.message-markdown`，提及块与已发送消息共用同一规则，随第 11 项一并修复（`2cd0583df`） |
| 14 | @ 自动补全：头像、名称、Agent 标记、所有者、不在频道 | `MentionAutocomplete.tsx` | client-kit 移植；Web 原未传 Agent 所有者 | 已修 | 一致 | shots/14；`6bee7c596` |
| 15 | Agent 消息“管理者为”：显示名、不截断、点开资料卡 | `MessageAgentOwner.tsx` | client-kit `messages/system/MessageAgentOwner.tsx` | 已修 | 已修 | shots/05、08（修复前“k…”）；`3d7ab0bc5` |
| 16 | 线程摘要：回复数、参与者、最后回复；全部回复删除后隐藏 | `MessageThreadSummaryRow.tsx` | client-kit `messages/thread/MessageThreadSummaryRow.tsx` | 已修 | 已修 | shots/07；`3d7ab0bc5` |
| 17 | 线程面板：根消息、回复、线程输入框、关注/静音 | `ThreadPanel.tsx` | client-kit `ThreadPanelSurface.tsx` | 一致 | 一致 | shots/08 |
| 18 | 悬停动作栏：回应、回复、复制链接、更多 | `MessageActionBar.tsx` | client-kit `MessageActionBarSurface.tsx` | 一致 | 一致 | shots/06 |
| 19 | 回应：emoji 聚合、自定义表情、计数、本人高亮 | `MessageReactions.tsx` | client-kit `MessageReactions` | 一致 | 一致 | 代码核对（部署频道近期无回应） |
| 20 | 附件：图片拼图、灯箱、文件卡、视频、快照卡 | `ImageMosaic.tsx`、`FileCard.tsx`、`MarkdownVideoPlayer.tsx`、`AgentSnapshotCard.tsx` | client-kit `image-lightbox/*`、`FileCard`、`SnapshotCard` | 一致 | 一致 | shots/11 |
| 21 | 链接预览：卡片、对所有人移除 | `useMessageLinkPreviews.ts` | client-kit `link-preview/*`（DD-125(5) 经 BFF） | 一致 | 一致 | 代码核对 |
| 22 | 频道链接、消息链接、实体链接 | `ChannelDeepLink.tsx`、`MessageLinkPill.tsx`、`entityLinks.tsx` | Web `BffMessageLinkHost.tsx` + client-kit remark 插件 | 一致 | 一致 | 代码核对 |
| 23 | 引用回复横幅、编辑态、删除确认 | `ComposerReplyBanner.tsx`、编辑器 | client-kit 共享 | 一致 | 一致 | 代码核对 |
| 24 | 输入框工具栏：附件、语音、表情/GIF、格式、发送 | `MessageComposerToolbar.tsx`、`FormattingToolbar.tsx` | client-kit `ComposerControls.tsx` | 一致 | 一致 | shots/13、16、17 |
| 25 | 输入中提示、Agent 工作中 | `TypingIndicator`、`BotActivityBar.tsx` | client-kit `agent-activity/*` | 一致 | 一致 | 代码核对 |
| 26 | 剧透、表情短码、频道自动补全 | `SpoilerInline.tsx`、自动补全 | client-kit `remarkSpoilers`、`useEmojiAutocomplete`、`useChannelLinks` | 一致 | 一致 | 代码核对 |
| 27 | 日期分隔、未读分隔与未读胶囊、频道开场块 | `MessageTimeline.tsx`（`UnreadPill`、`ChannelIntroBlock`） | client-kit `messages/timeline/MessageTimelineSurface.tsx` | 一致 | 一致 | shots/01 |

计数（27 项，r12 fork AS 复核后）：Web 一致 19、已修 8、缺失 0；Desktop 一致 23、已修 4。

**主要发现（r12 复核更正）**：第 4–8 项最初判为 Web 缺失，复核发现 Web 渲染器展开了 client-kit 共享的 `MESSAGE_BODY_COMPONENTS`（列表、标题、引用、表格、分隔线均在其中），已用测试证明渲染，改为一致。Web 真正缺的是任务列表复选框与隐藏链接提示（第 9、10 项），已迁入 client-kit 修复。用户看到的“@ 不高亮”的直接原因是 DD-141 把提及 chip 设成了几乎不可见的 brand-soft，消息正文与输入框同受影响，已按设计 20 新增提及令牌修复（第 11、13 项）。

## 2. 按区域汇总（逐文件判定）

总计 1726 个原版界面源码文件（`.ts/.tsx/.css`，不含测试）：一致 1348，缺失 24，不同 354。“不同”中 328 个是清单 (a) 的宿主或治理适配，13 个清单待定，8 个设计排除，5 个视觉由 DD-141 接管。

| 区域 | 一致 | 缺失 | 不同 | 截图 |
|---|---:|---:|---:|---|
| shared | 285 | 0 | 59 | — |
| messages | 212 | 0 | 26 | 01、04–11 |
| agents | 143 | 0 | 90 | 33（待补） |
| projects | 207 | 4 | 1 | 34（待补） |
| channels | 96 | 3 | 38 | 01、03、18 |
| app | 48 | 4 | 15 | — |
| profile | 52 | 0 | 10 | 12 |
| onboarding | 12 | 0 | 43 | — |
| workflows | 47 | 0 | 1 | 36（待补） |
| settings | 28 | 2 | 15 | 38、39-*（待补） |
| sidebar | 32 | 0 | 13 | 30（待补） |
| home | 31 | 0 | 3 | 32（待补） |
| huddle | 19 | 11 | 0 | —（暂缓） |
| communities | 9 | 0 | 18 | — |
| protectedFeatures | 16 | 0 | 0 | — |
| forum | 15 | 0 | 0 | — |
| reminders | 12 | 0 | 0 | — |
| notifications | 5 | 0 | 6 | — |
| pulse | 11 | 0 | 0 | 35（待补） |
| terminal | 7 | 0 | 4 | — |
| moderation | 10 | 0 | 0 | — |
| search | 10 | 0 | 0 | 19 |
| community-members | 9 | 0 | 0 | — |
| local-archive | 3 | 0 | 5 | — |
| mesh-compute | 0 | 0 | 7 | — |
| user-status | 6 | 0 | 0 | — |
| custom-emoji | 5 | 0 | 0 | — |
| presence | 4 | 0 | 0 | — |
| agent-memory | 3 | 0 | 0 | — |
| gifs | 3 | 0 | 0 | — |
| testing | 3 | 0 | 0 | — |
| channel-templates | 2 | 0 | 0 | — |
| (root) | 1 | 0 | 0 | — |
| chat | 1 | 0 | 0 | — |
| identity-archive | 1 | 0 | 0 | — |

## 3. 缺失项（逐文件）

| 区域 | 原版文件 | 说明 |
|---|---|---|
| app | `app/RootErrorBoundary.tsx` | Kailo 中未找到对应文件且清单未登记 |
| app | `app/huddleBackingChannelStorage.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| app | `app/huddleChannelVisibility.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| app | `app/useHuddlePresentation.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/channels | `features/channels/ui/useHuddleChannelMessages.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/channels | `features/channels/ui/useHuddleReadMarker.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/channels | `features/channels/ui/useHuddleThreadIsolation.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/HuddlePresenceContext.tsx` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/index.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/components/AgentVoiceMenu.tsx` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/components/HuddleProfileControl.tsx` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/components/HuddleRoomHeader.tsx` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/components/HuddleStartingView.tsx` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/components/HuddleTranscriptIntro.tsx` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/lib/huddleWindow.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/lib/ttsLiveMessages.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/lib/usePipelineHotstart.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/huddle | `features/huddle/lib/useTtsSubscription.ts` | 清单 (c) 未恢复：Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 |
| features/projects | `features/projects/useProjectsRepoSnapshots.ts` | 清单 (c) 未恢复：完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、 |
| features/projects | `features/projects/ui/projectsViewWorkItems.ts` | 清单 (c) 未恢复：完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、 |
| features/projects | `features/projects/ui/useProjectProfilePanel.ts` | 清单 (c) 未恢复：完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、 |
| features/projects | `features/projects/ui/useProjectRepositoryOpenActions.ts` | 清单 (c) 未恢复：仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| features/settings | `features/settings/ui/VoiceSettingsCard.tsx` | 清单 (c) 未恢复：Voice 设置分区 DD-125(5) 写明保留；Kailo 共享设置只有 10 类，无 voice |
| features/settings | `features/settings/ui/voiceSettingsLogic.ts` | 清单 (c) 未恢复：Voice 设置分区 DD-125(5) 写明保留；Kailo 共享设置只有 10 类，无 voice |

第 1 节的 Web 交互层缺失经复核为 2 项（第 9、10 项），r12 已修。


## 4. “不同”项（逐文件）

| 原版文件 | 清单行 | 状态 | 说明 | Web |
|---|---|---|---|---|
| `app/AppShell.helpers.ts` | M 第348行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `app/AppTopChrome.tsx` | M 第353行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `app/communityViewTransition.ts` | D 第360行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `app/routes.ts` | M 第375行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `app/useAppShellDesktopNotifications.ts` | M 第393行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `app/useAppShellLifecycleEffects.ts` | M 第395行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `app/useChannelActivityProjection.ts` | M 第397行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `app/useCommunityNavigationTransitions.ts` | D 第399行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `app/navigation/resolveSearchHitDestination.ts` | M 第368行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `app/navigation/searchHitNavigation.ts` | M 第371行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `app/routes/ChannelRouteScreen.tsx` | M 第376行 | 不同 | 清单待定：原地删减较多（+30/-100），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 | — |
| `app/routes/channels.$channelId.tsx` | M 第380行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `app/routes/index.tsx` | M 第381行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `app/routes/root.tsx` | M 第388行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `app/routes/settings.tsx` | M 第390行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/agents/acpRuntimesQuery.ts` | D 第423行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/activeAgentTurnsStore.ts` | D 第425行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/cardMintStore.ts` | D 第436行 | 不同 | 按设计适配（清单 (a)）：卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量 | — |
| `features/agents/knownAgentPubkeys.ts` | D 第443行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/managedAgentReconciliationPlan.ts` | D 第511行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/managedAgentRuntimeHooks.ts` | D 第513行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/managedAgentRuntimeStatus.ts` | D 第516行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/observerRelayStore.ts` | D 第517行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/preventSleepActivity.ts` | D 第526行 | 不同 | 按设计适配（清单 (a)）：防休眠对象是一期不存在的本机 Agent，排除 | — |
| `features/agents/useAgentObserverIngestion.ts` | D 第769行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/useGlobalAgentConfig.ts` | D 第771行 | 不同 | 按设计适配（清单 (a)）：Agent 默认配置对象是本机 Agent，排除 | — |
| `features/agents/useKnownAgentPubkeys.tsx` | D 第773行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/useManagedAgentRuntimeReconciliation.ts` | D 第774行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/usePreventSleep.ts` | D 第777行 | 不同 | 按设计适配（清单 (a)）：防休眠对象是一期不存在的本机 Agent，排除 | — |
| `features/agents/lib/agentCardAvatar.ts` | D 第449行 | 不同 | 按设计适配（清单 (a)）：卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量 | — |
| `features/agents/lib/agentCardGalleryState.ts` | D 第451行 | 不同 | 按设计适配（清单 (a)）：卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量 | — |
| `features/agents/lib/agentCardModelLabel.ts` | D 第453行 | 不同 | 按设计适配（清单 (a)）：卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量 | — |
| `features/agents/lib/agentConfigCore.ts` | D 第455行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/agentParallelism.ts` | D 第459行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/autoRestartPolicy.ts` | D 第461行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/cancelTurnOutcome.ts` | D 第463行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/formatAgentModelLabel.ts` | D 第467行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/friendlyAgentLastError.ts` | D 第469行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/liveSwitchOutcome.ts` | D 第473行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/otherSetupAgent.ts` | D 第478行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/resolvePersonaRuntime.ts` | D 第489行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/useAgentAvailability.ts` | D 第497行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/useAutoRestartPolicy.ts` | D 第500行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/useInstallOutputLine.ts` | D 第504行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/lib/useLastRuntime.ts` | D 第505行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/AddCustomHarnessDialog.tsx` | D 第530行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/agents/ui/AdvancedRequiredBadge.tsx` | D 第532行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/AgentAiConfigurationMode.tsx` | D 第533行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/AgentAiDefaults.tsx` | D 第534行 | 不同 | 按设计适配（清单 (a)）：Agent 默认配置对象是本机 Agent，排除 | — |
| `features/agents/ui/AgentCardMintDialog.tsx` | D 第536行 | 不同 | 按设计适配（清单 (a)）：卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量 | — |
| `features/agents/ui/AgentCardViewerDialog.tsx` | D 第537行 | 不同 | 设计排除（DD-131(5) 卡片铸造） | — |
| `features/agents/ui/AgentConfigFields.tsx` | D 第538行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/AgentConfigPanel.tsx` | D 第539行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/AgentDefaultsDialog.tsx` | D 第543行 | 不同 | 按设计适配（清单 (a)）：Agent 默认配置对象是本机 Agent，排除 | — |
| `features/agents/ui/AgentDefaultsEditor.tsx` | D 第544行 | 不同 | 按设计适配（清单 (a)）：Agent 默认配置对象是本机 Agent，排除 | — |
| `features/agents/ui/AgentHarnessField.tsx` | D 第552行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/agents/ui/AgentRunLocationContext.tsx` | D 第556行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/AgentRuntimeAvatarControl.tsx` | D 第557行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/CardMintComposerChip.tsx` | D 第576行 | 不同 | 按设计适配（清单 (a)）：卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量 | — |
| `features/agents/ui/CardMintKeyCue.tsx` | D 第577行 | 不同 | 按设计适配（清单 (a)）：卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量 | — |
| `features/agents/ui/EditAgentAdvancedFields.tsx` | D 第583行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/EditAgentProviderModelFields.tsx` | D 第584行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/EffortPickerField.tsx` | D 第585行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/EnvVarsEditor.tsx` | D 第587行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/HarnessCatalogRetryNotice.tsx` | D 第590行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/agents/ui/ManagedAgentLogPanel.tsx` | D 第592行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/ManagedAgentRow.tsx` | D 第593行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/McpServersSection.tsx` | D 第596行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/ModelPicker.tsx` | D 第597行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/OtherSetupAgentMarker.tsx` | D 第598行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/PersonaAdvancedFields.tsx` | D 第602行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/PersonaModelCombobox.tsx` | D 第606行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/PersonaModelField.tsx` | D 第607行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/PersonaProviderApiKeyField.tsx` | D 第609行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/ProviderConfigFields.tsx` | D 第614行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/RawEventRail.tsx` | D 第615行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/RestartDiffBadge.tsx` | D 第619行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/RunOnSummarySection.tsx` | D 第620行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/WhereToRunSection.tsx` | D 第632行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/addCustomHarness.ts` | D 第650行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/agents/ui/agentAiConfigurationPolicy.ts` | D 第652行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/agentConfigControls.tsx` | D 第654行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/archivePagingState.ts` | D 第695行 | 不同 | 设计排除（DD-125(6) 不发 24200 观察帧） | — |
| `features/agents/ui/bakedEnvHelpers.ts` | D 第696行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/buzzAgentConfig.ts` | D 第698行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/buzzAgentModelTuningFields.tsx` | D 第699行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/cardMintKeyUtils.ts` | D 第700行 | 不同 | 按设计适配（清单 (a)）：卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量 | — |
| `features/agents/ui/effortPicker.ts` | D 第709行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/globalAgentCredentialState.ts` | D 第713行 | 不同 | 按设计适配（清单 (a)）：Agent 默认配置对象是本机 Agent，排除 | — |
| `features/agents/ui/modelCapabilities.ts` | D 第716行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/personaDialogEnvVars.ts` | D 第721行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/personaModelDiscoveryStatus.ts` | D 第726行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/personaRuntimeModel.ts` | D 第728行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/providerApiKeyFieldState.ts` | D 第730行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/providerEnvVarUpdates.ts` | D 第732行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/relayMeshModelPicker.ts` | D 第735行 | 不同 | 按设计适配（清单 (a)）：Compute（本机算力供他人运行 Agent）属第二运行链，排除 | — |
| `features/agents/ui/runOnSummary.ts` | D 第738行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/runtimeAvailabilityWarning.ts` | D 第740行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/runtimeModelProviderSelection.ts` | D 第742行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/useAgentDialogDefaults.ts` | D 第753行 | 不同 | 按设计适配（清单 (a)）：Agent 默认配置对象是本机 Agent，排除 | — |
| `features/agents/ui/useObserverEvents.ts` | D 第756行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/usePersonaModelDiscovery.ts` | D 第759行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/useRequiredCredentialState.ts` | D 第760行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/whereToRunIntent.ts` | D 第765行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/agents/ui/activityRenderClasses/RawRailActivity.tsx` | D 第639行 | 不同 | 按设计适配（清单 (a)）：本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent  | — |
| `features/channels/channelSnapshot.ts` | M 第794行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/rosterFreshness.ts` | M 第841行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/unreadChannelCounts.ts` | M 第927行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/useLiveChannelUpdates.ts` | M 第936行 | 不同 | 清单待定：原地删减较多（+19/-86），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 | — |
| `features/channels/useMessageEventProfilePubkeys.ts` | M 第937行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/useThreadTargetSync.ts` | M 第939行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/useWelcomeAgentCreate.ts` | D 第942行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/channels/lib/channelDescription.ts` | M 第810行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `features/channels/lib/ephemeralChannel.ts` | M 第817行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `features/channels/readState/readStateFormat.ts` | M 第833行 | 不同 | 按设计适配（清单 (a)）：已读格式随 CollaborationUserState 简化 | — |
| `features/channels/readState/readStateIdentity.ts` | D 第834行 | 不同 | 按设计适配（清单 (a)）：已读 cursor 由 Core CollaborationUserState 持久化 | — |
| `features/channels/readState/readStateManager.ts` | M 第836行 | 不同 | 按设计适配（清单 (a)）：已读 frontier 同步改为 CollaborationUserState | — |
| `features/channels/readState/readStateSnapshot.ts` | D 第837行 | 不同 | 按设计适配（清单 (a)）：已读 cursor 由 Core CollaborationUserState 持久化 | — |
| `features/channels/readState/readStateStorage.ts` | M 第839行 | 不同 | 按设计适配（清单 (a)）：已读本机存储随 CollaborationUserState 简化 | — |
| `features/channels/readState/useReadState.ts` | M 第840行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/AddChannelBotDialog.tsx` | D 第842行 | 不同 | 按设计适配（清单 (a)）：频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCr | — |
| `features/channels/ui/AddChannelBotGenericSection.tsx` | D 第843行 | 不同 | 按设计适配（清单 (a)）：频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCr | — |
| `features/channels/ui/AddChannelBotPersonasSection.tsx` | D 第844行 | 不同 | 按设计适配（清单 (a)）：频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCr | Web 共享 |
| `features/channels/ui/AddChannelBotReuseGuard.tsx` | D 第845行 | 不同 | 按设计适配（清单 (a)）：频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCr | — |
| `features/channels/ui/ChannelPane.helpers.ts` | M 第863行 | 不同 | 按设计适配（清单 (a)）：Welcome 频道引导三卡移除（其余空频道动作卡待核） | — |
| `features/channels/ui/ChannelScreenLazyViews.ts` | M 第870行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/ThreadPanelSurface.tsx` | M 第885行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `features/channels/ui/WelcomeAgentCreateDialog.tsx` | D 第887行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/channels/ui/WelcomeComposerBanner.tsx` | D 第888行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/channels/ui/channelSearchKeys.ts` | M 第893行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/useChannelIntro.tsx` | M 第899行 | 不同 | 按设计适配（清单 (a)）：Welcome 频道引导三卡移除（其余空频道动作卡待核） | — |
| `features/channels/ui/useChannelOpenReadState.ts` | M 第900行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/useChannelPaneMessages.ts` | M 第901行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/useChannelPanelHistoryState.ts` | M 第902行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/useChannelProfilePanel.ts` | M 第903行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/useChannelTargetReset.ts` | M 第905行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/useChannelUnreadState.ts` | M 第906行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/useEffectiveRuntimes.ts` | D 第907行 | 不同 | 按设计适配（清单 (a)）：频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCr | — |
| `features/channels/ui/useInChannelPersonaIds.ts` | D 第913行 | 不同 | 按设计适配（清单 (a)）：频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCr | — |
| `features/channels/ui/useMessageProfiles.ts` | M 第916行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/channels/ui/useReusableAgentDetection.ts` | D 第920行 | 不同 | 按设计适配（清单 (a)）：频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCr | — |
| `features/channels/ui/useWelcomeComposerBanner.ts` | D 第924行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/channels/ui/useWelcomeInitialUnreadSuppression.ts` | D 第926行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/communities/communityMarkRead.ts` | D 第959行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/communityNavigationStorage.ts` | D 第961行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/communityStorage.ts` | D 第963行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/communityUnreadObserver.ts` | D 第965行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/hostedCommunityApi.ts` | D 第967行 | 不同 | 按设计适配（清单 (a)）：Hosted communities：Community 只由 Tenant 生命周期经 operator 建立，排除 | — |
| `features/communities/leaveCommunity.ts` | D 第969行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/legacyCommunityStorage.ts` | D 第971行 | 不同 | 按设计适配（清单 (a)）：旧版本机存储迁移；偏好权威改为 CollaborationUserState | — |
| `features/communities/relayProbe.ts` | D 第974行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/useCommunities.tsx` | D 第988行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/useCommunityInit.ts` | D 第990行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/useCommunityUnread.ts` | D 第991行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/useNestNotifications.ts` | D 第992行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/ui/AddCommunityDialog.tsx` | D 第978行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/ui/CommunityChangeOverlay.tsx` | D 第980行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/ui/CommunitySwitcher.tsx` | D 第983行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/communities/ui/HostedCommunityCreateFlow.tsx` | D 第985行 | 不同 | 按设计适配（清单 (a)）：Hosted communities：Community 只由 Tenant 生命周期经 operator 建立，排除 | — |
| `features/communities/ui/HostedCommunityOnboarding.tsx` | D 第986行 | 不同 | 按设计适配（清单 (a)）：Hosted communities：Community 只由 Tenant 生命周期经 operator 建立，排除 | — |
| `features/communities/ui/WelcomeSetup.tsx` | D 第987行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/home/hooks.ts` | M 第1059行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/home/useHomeInboxContextMessages.ts` | M 第1089行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/home/ui/HomeScreen.tsx` | M 第1076行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/local-archive/agentMetricArchivePreference.ts` | D 第1150行 | 不同 | 设计排除（DD-125(6)、DD-159(1) 指标存档） | — |
| `features/local-archive/observerArchivePreference.ts` | D 第1151行 | 不同 | 设计排除（DD-125(6)、DD-159(1) 观察帧存档） | — |
| `features/local-archive/useAgentMetricArchiveSeed.ts` | D 第1156行 | 不同 | 设计排除（DD-125(6)、DD-159(1)） | — |
| `features/local-archive/useArchiveAgentMetricsBridge.ts` | D 第1157行 | 不同 | 设计排除（DD-125(6)、DD-159(1)） | — |
| `features/local-archive/useObserverArchiveSeed.ts` | D 第1161行 | 不同 | 设计排除（DD-125(6)、DD-159(1)） | — |
| `features/mesh-compute/classifyModelRef.ts` | D 第1168行 | 不同 | 按设计适配（清单 (a)）：Compute（本机算力供他人运行 Agent）属第二运行链，排除 | — |
| `features/mesh-compute/servingUsage.ts` | D 第1173行 | 不同 | 按设计适配（清单 (a)）：Compute（本机算力供他人运行 Agent）属第二运行链，排除 | — |
| `features/mesh-compute/shareToggleState.ts` | D 第1175行 | 不同 | 按设计适配（清单 (a)）：Compute（本机算力供他人运行 Agent）属第二运行链，排除 | — |
| `features/mesh-compute/hooks/useMeshDownloadProgress.ts` | D 第1169行 | 不同 | 按设计适配（清单 (a)）：Compute（本机算力供他人运行 Agent）属第二运行链，排除 | — |
| `features/mesh-compute/hooks/useMeshNodeStatus.ts` | D 第1170行 | 不同 | 按设计适配（清单 (a)）：Compute（本机算力供他人运行 Agent）属第二运行链，排除 | — |
| `features/mesh-compute/hooks/useMeshServingUsage.ts` | D 第1171行 | 不同 | 按设计适配（清单 (a)）：Compute（本机算力供他人运行 Agent）属第二运行链，排除 | — |
| `features/mesh-compute/ui/MeshComputeSettingsCard.tsx` | D 第1176行 | 不同 | 按设计适配（清单 (a)）：Compute（本机算力供他人运行 Agent）属第二运行链，排除 | — |
| `features/messages/useIndependentThreadPanel.ts` | M 第1465行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/useThreadReplies.ts` | M 第1467行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/lib/agentMentionRevalidation.ts` | D 第1187行 | 不同 | 按设计适配（清单 (a)）：提及时拉起/确认本机 Agent 进程；Kailo 提及走 agent.invoke 准入并只读回显结论 | — |
| `features/messages/lib/backgroundMediaUploadStore.ts` | M 第1200行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/lib/buildMentionCandidates.ts` | M 第1202行 | 不同 | 清单待定：提及候选去掉 Agent 目录/persona/全局人员搜索合并；Agent 部分属 DD-26，“提及频道外成员”候选是否随 NonMem | Web 共享 |
| `features/messages/lib/canSendToChannel.ts` | M 第1205行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `features/messages/lib/draftMentionRefs.ts` | M 第1222行 | 不同 | 清单待定：同上（提及候选） | — |
| `features/messages/lib/flushMentionDebounce.ts` | M 第1229行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/lib/independentThreadPanel.ts` | M 第1238行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/lib/mentionCandidates.ts` | M 第1246行 | 不同 | 清单待定：同上（提及候选） | Web 共享 |
| `features/messages/lib/mentionSuggestionMapping.ts` | M 第1260行 | 不同 | 清单待定：原地删减较多（+6/-88），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 | — |
| `features/messages/lib/messageRowEquality.ts` | M 第1269行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/lib/sendToChannelSemantics.ts` | M 第1294行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/lib/timelineImagePreload.ts` | M 第1309行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/lib/timelineMentionCopy.ts` | M 第1311行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/lib/useDraftMentionRouting.ts` | M 第1322行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/lib/useVerifyMentionIdentities.ts` | M 第1336行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/ui/MessageComposer.types.ts` | M 第1377行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/ui/MessageComposerAutocompletes.tsx` | M 第1378行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/ui/TimelineMessageRow.tsx` | M 第1403行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/ui/configNudgeAuthPubkey.ts` | D 第1413行 | 不同 | 按设计适配（清单 (a)）：提及时拉起/确认本机 Agent 进程；Kailo 提及走 agent.invoke 准入并只读回显结论 | — |
| `features/messages/ui/useComposerLinkPreviews.tsx` | M 第1433行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `features/messages/ui/useComposerMentionPicker.ts` | M 第1435行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/messages/ui/useDetachedAgentStart.ts` | D 第1439行 | 不同 | 按设计适配（清单 (a)）：提及时拉起/确认本机 Agent 进程；Kailo 提及走 agent.invoke 准入并只读回显结论 | — |
| `features/messages/ui/useEnsureAgentMentionsReady.ts` | D 第1442行 | 不同 | 按设计适配（清单 (a)）：提及时拉起/确认本机 Agent 进程；Kailo 提及走 agent.invoke 准入并只读回显结论 | — |
| `features/messages/ui/useMentionSendFlow.types.ts` | M 第1451行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/notifications/use-feed-desktop-notifications.ts` | M 第1504行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/notifications/useNotificationSenderName.ts` | M 第1505行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/notifications/lib/desktop.ts` | M 第1495行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/notifications/lib/feed.ts` | M 第1497行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/notifications/lib/homeBadge.ts` | M 第1498行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/notifications/lib/target.ts` | M 第1503行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/onboarding/communityOnboarding.tsx` | D 第1513行 | 不同 | 按设计适配（清单 (a)）：加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 | — |
| `features/onboarding/devFreshOnboarding.ts` | D 第1514行 | 不同 | 清单待定：上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 | — |
| `features/onboarding/machineOnboarding.ts` | D 第1521行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/useClaimInvite.ts` | D 第1569行 | 不同 | 按设计适配（清单 (a)）：加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 | — |
| `features/onboarding/useWelcomeKickoffEntrance.ts` | D 第1570行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/onboarding/useWelcomeKickoffStage.ts` | D 第1572行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/onboarding/useWelcomeKickoffStagePresence.tsx` | D 第1573行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/onboarding/welcome.ts` | D 第1575行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/onboarding/welcomeCanvas.ts` | D 第1577行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/onboarding/welcomeGuide.ts` | D 第1579行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/onboarding/welcomeKickoff.ts` | D 第1581行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/onboarding/lib/encryptedBackup.ts` | D 第1517行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/lib/keyImportInput.ts` | D 第1519行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/BackupPasswordTimeline.tsx` | D 第1523行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/BackupStep.tsx` | D 第1524行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/BackupTestFlow.tsx` | D 第1525行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/CommunityOnboardingFlow.tsx` | D 第1526行 | 不同 | 按设计适配（清单 (a)）：加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 | — |
| `features/onboarding/ui/ConnectionMethodSection.tsx` | D 第1527行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/DefaultConfigStep.tsx` | D 第1528行 | 不同 | 按设计适配（清单 (a)）：Agent 默认配置对象是本机 Agent，排除 | — |
| `features/onboarding/ui/DownloadKeyStep.tsx` | D 第1529行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/EncryptedBackupCreator.tsx` | D 第1530行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/HarnessMarks.tsx` | D 第1531行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/onboarding/ui/IdentityKeyHelpDialog.tsx` | D 第1532行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/IdentityKeyIntroduction.tsx` | D 第1533行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/IdentityRecoveryPairing.tsx` | D 第1534行 | 不同 | 按设计适配（清单 (a)）：移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 | — |
| `features/onboarding/ui/InviteRedeemForm.tsx` | D 第1535行 | 不同 | 按设计适配（清单 (a)）：加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 | — |
| `features/onboarding/ui/JoinPolicyNotice.tsx` | D 第1536行 | 不同 | 按设计适配（清单 (a)）：加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 | — |
| `features/onboarding/ui/KeyringLockedScreen.tsx` | D 第1537行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/LandingBees.tsx` | D 第1538行 | 不同 | 纯视觉，由 DD-141 接管 | — |
| `features/onboarding/ui/MachineOnboardingFlow.tsx` | D 第1539行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/MembershipDenied.tsx` | D 第1540行 | 不同 | 按设计适配（清单 (a)）：加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 | — |
| `features/onboarding/ui/NostrKeyImportForm.tsx` | D 第1541行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/PendingInviteGate.tsx` | D 第1549行 | 不同 | 按设计适配（清单 (a)）：加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 | — |
| `features/onboarding/ui/RecoveryScreen.tsx` | D 第1551行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/RelaunchRequiredScreen.tsx` | D 第1552行 | 不同 | 清单待定：上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 | — |
| `features/onboarding/ui/ResetFailedScreen.tsx` | D 第1553行 | 不同 | 清单待定：上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 | — |
| `features/onboarding/ui/RuntimeErrorTooltip.tsx` | D 第1554行 | 不同 | 按设计适配（清单 (a)）：本机运行时选择 | — |
| `features/onboarding/ui/RuntimeIcon.tsx` | D 第1555行 | 不同 | 按设计适配（清单 (a)）：本机运行时选择 | — |
| `features/onboarding/ui/SetupStep.tsx` | D 第1557行 | 不同 | 按设计适配（清单 (a)）：Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 | — |
| `features/onboarding/ui/WelcomeKickoffStage.tsx` | D 第1558行 | 不同 | 按设计适配（清单 (a)）：Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 | — |
| `features/onboarding/ui/agentReadiness.ts` | D 第1560行 | 不同 | 按设计适配（清单 (a)）：本机运行时选择 | — |
| `features/onboarding/ui/harnessConnectionOptions.ts` | D 第1562行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/onboarding/ui/onboardingRuntimeSelection.ts` | D 第1566行 | 不同 | 按设计适配（清单 (a)）：本机运行时选择 | — |
| `features/profile/avatarProfileSync.ts` | D 第1602行 | 不同 | 按设计适配（清单 (a)）：本机资料缓存同步；资料读写经平台/本人签名链 | — |
| `features/profile/profileCacheSync.ts` | D 第1624行 | 不同 | 按设计适配（清单 (a)）：本机资料缓存同步；资料读写经平台/本人签名链 | — |
| `features/profile/lib/nostrBindCallback.ts` | D 第1609行 | 不同 | 清单待定：上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/ | — |
| `features/profile/lib/nostrIdentityBinding.ts` | D 第1610行 | 不同 | 清单待定：上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/ | — |
| `features/profile/lib/selfProfileStorage.ts` | M 第1618行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/profile/lib/userLabelStorage.ts` | M 第1622行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/profile/ui/ArchiveConfirmDialog.tsx` | D 第1633行 | 不同 | 按设计适配（清单 (a)）：Agent 物理删除不提供，映射为 agent.installation.disable | — |
| `features/profile/ui/NostrBindConsentDialog.tsx` | D 第1637行 | 不同 | 清单待定：上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/ | — |
| `features/profile/ui/ProfileAvatar.tsx` | M 第1638行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/profile/ui/UserProfilePanelDeletion.ts` | D 第1657行 | 不同 | 按设计适配（清单 (a)）：Agent 物理删除不提供，映射为 agent.installation.disable | — |
| `features/projects/useRepositoryAccess.ts` | D 第1960行 | 不同 | 设计排除（DD-118、DD-160(1) 不区分仓库不可读原因） | — |
| `features/settings/lib/appearanceScopeCopy.ts` | D 第2032行 | 不同 | 按设计适配（清单 (a)）：“按社区/全局”外观作用域文案；外观偏好仅属当前设备 | — |
| `features/settings/lib/encryptedBackup.ts` | M 第2034行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/settings/ui/AgentDefaultsSettingsCard.tsx` | D 第2039行 | 不同 | 按设计适配（清单 (a)）：Agent 默认配置对象是本机 Agent，排除 | — |
| `features/settings/ui/CustomHarnessForm.tsx` | D 第2044行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/settings/ui/HarnessCatalogDialog.tsx` | D 第2048行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/settings/ui/HarnessRow.tsx` | D 第2049行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/settings/ui/HarnessesSettingsPanel.tsx` | D 第2050行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/settings/ui/HostedCommunitiesSettingsCard.tsx` | D 第2051行 | 不同 | 按设计适配（清单 (a)）：Hosted communities：Community 只由 Tenant 生命周期经 operator 建立，排除 | — |
| `features/settings/ui/MobilePairingCard.tsx` | D 第2053行 | 不同 | 按设计适配（清单 (a)）：移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 | — |
| `features/settings/ui/PreventSleepSettingsCard.tsx` | D 第2056行 | 不同 | 按设计适配（清单 (a)）：防休眠对象是一期不存在的本机 Agent，排除 | — |
| `features/settings/ui/SettingsScreen.tsx` | M 第2063行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/settings/ui/harnessCatalogCopy.ts` | D 第2070行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/settings/ui/harnessCatalogLogic.ts` | D 第2072行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/settings/ui/harnessFormLogic.ts` | D 第2074行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/settings/ui/harnessGalleryLogic.ts` | D 第2076行 | 不同 | 按设计适配（清单 (a)）：本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX | — |
| `features/sidebar/lib/channelMutesStorage.ts` | M 第2087行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/sidebar/lib/channelMutesSync.ts` | D 第2089行 | 不同 | 按设计适配（清单 (a)）：收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState | — |
| `features/sidebar/lib/channelSectionsHelpers.ts` | D 第2091行 | 不同 | 按设计适配（清单 (a)）：收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState | — |
| `features/sidebar/lib/channelSectionsStorage.ts` | D 第2093行 | 不同 | 按设计适配（清单 (a)）：收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState | — |
| `features/sidebar/lib/channelSectionsSync.ts` | D 第2095行 | 不同 | 按设计适配（清单 (a)）：收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState | — |
| `features/sidebar/lib/channelSortSync.ts` | D 第2099行 | 不同 | 按设计适配（清单 (a)）：收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState | — |
| `features/sidebar/lib/channelStarsStorage.ts` | M 第2101行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `features/sidebar/lib/channelStarsSync.ts` | D 第2103行 | 不同 | 按设计适配（清单 (a)）：收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState | — |
| `features/sidebar/lib/sidebarSyncWatermark.ts` | D 第2108行 | 不同 | 按设计适配（清单 (a)）：收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState | — |
| `features/sidebar/lib/useChannelMutes.ts` | M 第2112行 | 不同 | 按设计适配（清单 (a)）：静音同步改为 CollaborationUserState | — |
| `features/sidebar/lib/useChannelStars.ts` | M 第2117行 | 不同 | 按设计适配（清单 (a)）：收藏同步改为 CollaborationUserState | — |
| `features/sidebar/ui/CommunityRail.tsx` | D 第2129行 | 不同 | 按设计适配（清单 (a)）：多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Te | — |
| `features/sidebar/ui/sidebarLoadingSkeleton.tsx` | M 第2143行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `features/terminal/terminalBanner.ts` | D 第2159行 | 不同 | 纯视觉，由 DD-141 接管（终端字标与闪屏） | — |
| `features/terminal/terminalBannerColor.ts` | D 第2161行 | 不同 | 纯视觉，由 DD-141 接管（终端字标与闪屏） | — |
| `features/terminal/terminalBannerPainter.ts` | D 第2163行 | 不同 | 纯视觉，由 DD-141 接管（终端字标与闪屏） | — |
| `features/terminal/terminalBannerWave.ts` | D 第2165行 | 不同 | 纯视觉，由 DD-141 接管（终端字标与闪屏） | — |
| `features/workflows/hooks.ts` | D 第2194行 | 不同 | 按设计适配（清单 (a)）：Buzz Relay 自带 workflow 引擎/命令关闭；Workflows 产品页面改由 Core AutomationDefinit | — |
| `shared/deep-link.ts` | M 第2293行 | 不同 | 按设计适配（清单 (a)）：社区/邀请深链移除 | — |
| `shared/useAppDeepLinks.ts` | M 第2294行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/agentControl.ts` | D 第2301行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/agentModels.ts` | D 第2302行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/channelWindow.ts` | M 第2303行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/communityProfile.ts` | D 第2304行 | 不同 | 按设计适配（清单 (a)）：频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 | — |
| `shared/api/concurrency.ts` | D 第2305行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/identityTypes.ts` | M 第2310行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/installTypes.ts` | M 第2311行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/inviteHelpers.ts` | D 第2313行 | 不同 | 按设计适配（清单 (a)）：频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 | — |
| `shared/api/invites.ts` | D 第2315行 | 不同 | 按设计适配（清单 (a)）：频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 | — |
| `shared/api/observerRelay.ts` | D 第2318行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/relayChannelFilters.ts` | M 第2328行 | 不同 | 按设计适配（清单 (a)）：Relay 频道目录过滤改经 BFF | — |
| `shared/api/relayClientSession.ts` | M 第2329行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `shared/api/relayClientShared.ts` | M 第2330行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/relayClosedRecovery.ts` | M 第2332行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/relayEventPublisher.ts` | M 第2333行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/relayGateBoundary.ts` | M 第2334行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/relayMembers.ts` | D 第2336行 | 不同 | 按设计适配（清单 (a)）：频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 | — |
| `shared/api/social.ts` | D 第2339行 | 不同 | 按设计适配（清单 (a)）：Pulse 关注改为 CollaborationUserState.followed_principals（kind 3 不进成员白名单） | — |
| `shared/api/socialTypes.ts` | M 第2340行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/tauriAcpDiscovery.ts` | D 第2342行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/tauriAgentAccess.ts` | D 第2343行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/tauriAgentAuth.ts` | D 第2344行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/tauriChannelHeadCache.ts` | M 第2346行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/tauriChannelTemplates.ts` | D 第2347行 | 不同 | 按设计适配（清单 (a)）：频道模板本机存储改为 CollaborationUserState.channel_templates | — |
| `shared/api/tauriChannels.ts` | M 第2348行 | 不同 | 按设计适配（清单 (a)）：频道管理 Tauri 命令封装移除 | — |
| `shared/api/tauriEngrams.ts` | D 第2349行 | 不同 | 按设计适配（清单 (a)）：Agent 记忆（NIP-AE）由 Core 以 Installation/CONTROL pair 读写，客户端不直写 | — |
| `shared/api/tauriGlobalAgentConfig.ts` | D 第2350行 | 不同 | 按设计适配（清单 (a)）：Agent 默认配置对象是本机 Agent，排除 | — |
| `shared/api/tauriIdentity.ts` | M 第2351行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
| `shared/api/tauriManagedAgentMessageMarkers.ts` | D 第2353行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/tauriManagedAgents.ts` | D 第2355行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/tauriMedia.ts` | M 第2356行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/tauriMesh.ts` | D 第2357行 | 不同 | 按设计适配（清单 (a)）：Compute（本机算力供他人运行 Agent）属第二运行链，排除 | — |
| `shared/api/tauriMessages.ts` | M 第2358行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/api/tauriObserver.ts` | D 第2359行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/tauriPairing.ts` | D 第2360行 | 不同 | 按设计适配（清单 (a)）：移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 | — |
| `shared/api/tauriPersonas.ts` | D 第2363行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/tauriRelayAgents.ts` | D 第2365行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 管理/observer 的 Tauri API 封装 | — |
| `shared/api/tauriWorkflows.ts` | D 第2368行 | 不同 | 按设计适配（清单 (a)）：Buzz Relay 自带 workflow 引擎/命令关闭；Workflows 产品页面改由 Core AutomationDefinit | — |
| `shared/api/tauriWorkspace.ts` | M 第2369行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/context/ProfilePanelContext.tsx` | M 第2385行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/hooks/useWebviewScrollBoundaryLock.ts` | M 第2419行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/lib/computeConfigNudge.ts` | D 第2440行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 配置提示/安装错误 | — |
| `shared/lib/configNudge.ts` | D 第2442行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 配置提示/安装错误 | — |
| `shared/lib/installError.ts` | D 第2461行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 配置提示/安装错误 | — |
| `shared/lib/localStorageSweep.ts` | M 第2469行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/lib/mediaUrl.ts` | M 第2471行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/lib/nostrUtils.ts` | M 第2478行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/lib/relayError.ts` | M 第2485行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/theme/CommunityThemeController.tsx` | M 第2528行 | 不同 | 按设计适配（清单 (a)）：按社区外观同步移除 | — |
| `shared/theme/communityThemeSync.ts` | D 第2535行 | 不同 | 按设计适配（清单 (a)）：按社区跨设备同步外观偏好（经 Relay 加密偏好）；DD-53 规定外观偏好仅属于当前设备，不新增服务端偏好权威 | — |
| `shared/ui/calendar.tsx` | D 第2581行 | 不同 | 清单待定：通用 UI 件，随所属功能（引导、资料活动轮播、日期选择）处置 | — |
| `shared/ui/config-nudge-attachment.tsx` | D 第2587行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 配置提示/安装错误 | — |
| `shared/ui/import-status-icon.tsx` | D 第2593行 | 不同 | 按设计适配（清单 (a)）：本机 Agent 配置提示/安装错误 | — |
| `shared/ui/styled-qr-code.tsx` | D 第2646行 | 不同 | 按设计适配（清单 (a)）：仅供移动端配对二维码，配对向手机交付私钥被排除 | — |
| `shared/ui/markdown/runtimeContext.ts` | M 第2623行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/ui/markdown/types.ts` | M 第2624行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | — |
| `shared/ui/markdown/useMessageLinkPreviews.ts` | M 第2627行 | 不同 | 按设计适配（清单 (a)）：Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） | Web 共享 |
