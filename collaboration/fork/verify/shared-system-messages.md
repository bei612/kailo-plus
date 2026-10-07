# 原版系统消息、频道窗口与表情：共享实现证据

## 2026-10-07 源码批次

本记录关联 REQ-24、DD-39/53/75/80，覆盖既有 Buzz 客户端接缝，不改变领域设计。
比较基准为 `53ad340097fd802f85d4e31aa3a3eaad12cf423e`；该提交已将服务端原生窗口
读取合入并推送 main。这里记录随后共享客户端增量，不将源码恢复称为已部署。

固定上游为 `/volumes/kailo/.references/buzz` 的
`779af8886caae1317b4de962082429867ab61503`。实际读取的原文件与符号为：

- `desktop/src/features/messages/ui/SystemMessageRow.tsx::SystemMessageRow`：成员
  到达合并、加入后离开、公开删除理由、Agent owner、回应和原布局。
- `desktop/src/features/messages/ui/SystemMessageAvatars.tsx::SystemMessageAvatar`、
  `MembershipAvatarStack` 与 `MessageAgentOwner.tsx::MessageAgentOwner`。
- `desktop/src/features/messages/lib/membershipGroupPayload.ts::buildGroupedMembershipPayload`、
  `systemEventCopy.ts::describeChannelTextFieldChange`。
- `desktop/src/shared/ui/InlineChip.tsx::InlineChip` 与
  `desktop/src/shared/styles/globals/markdown.css` 的 `.message-markdown` 规则。
- `desktop/src/features/messages/ui/MessageReactions.tsx::MessageReactions`、
  `useReactionHandler.ts::useReactionHandler` 与 `useQuickReactionEmojis.ts`。
- `desktop/src/features/custom-emoji/ui/EmojiPicker.tsx::EmojiPicker`、
  `desktop/src/features/custom-emoji/emojiMartCategory.ts::buildCustomEmojiCategory`、
  `desktop/src/features/messages/lib/customEmojiNode.ts::CustomEmojiNode` 与
  `useComposerCustomEmoji.ts::useComposerCustomEmoji`：原选择器、分类及图片 atom。
- `desktop/src/features/messages/lib/channelWindowStore.ts::appendOlderChannelWindow`：
  原频道窗口与复合游标，Native 原路径变为共享导出。

四步影响结论：

1. 权威仍为 Relay 的已授权窗口、签名事件与原成员资料读取；UI 不把 Relay 的系统
   事件签名者当成人类 actor。共享的是原显示实现，不新建身份、事件或回应权威。
2. 读写链涉及 Web ChannelPane/草稿恢复、Native SystemMessageRow 与共用 timeline。
   UI 类型恢复原 TimelineReaction/owner 字段，不修改 JSON Schema、数据库或
   Workflow。Desktop 保持本机签名和 Relay 读取；Web 保持 BFF 签名及 scope fence。
   Mobile 仅从原生成器接收同源词条，不借此声称已恢复移动端界面。
3. Web 成员悬浮信息复用既有 memberProfile 授权口；原始媒体地址不会因恢复头像
   自动放行。回应写入只在宿主提供真实回调时启用；UNKNOWN 保持中性文案且不重复
   派发。设备上 Agent 管理位置没有可信投影时，不捏造“由另一设备管理”。
4. null/数组/错误 actor 类型的系统 payload 返回无有效系统行，不抛出使整条时间线
   崩溃；未知 type 不伪装已知成功。重复成员事件沿原分组；迟到分页与撤权由现有
   scope/generation fence 丢弃；新 live 普通回复不冒充原窗口顶层行。身份变化不迁移
   另一个用户的本地回应偏好。写入异常仍交宿主既有错误分类及结果对账。

授权差异只有共源导入、可信宿主资料/媒体/写动作接缝，以及默认中文/英文。原版
完整 Markdown CSS 直接移到共享包，Web/Desktop 同时引用；与上述固定文件
`diff -u` 实际退出 0。删除 Native 旧 SystemMessageAvatars 实现及重复的系统行实现，
原路径仅保留必要宿主包装或共享导出，不保留另一份 UI 正文。

## 实际检查与边界

受限 SDK `kailo-agent-receipt-xvkujx` 回读为 4 CPU / 8 GiB，memory+swap 同为
8 GiB；检查前核验已有进程、CPU/内存压力与 Data 缓存。没有下载工具链或构建镜像。

- System 7 项与 Reaction 14 项实际通过，共 21 项。主动破坏 UNKNOWN 锁、公开删除
  不暴露完整 payload、重复加入后离开的合并逻辑，共 3 项实际失败；原字节 `cmp`
  恢复为 0，再次 21 项通过。日志为
  `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/system-reactions.adukG2/`
  中的 `baseline-final.log`、`mutation.log`、`restored.log`。
- 原 `tools/gen-platform-i18n.py` 与 `--check` 实际退出 0：
  `PASS: Mobile platform and reason catalogs match the shared TypeScript source`。
  本批共 48 个双语 key；Dart 生成物同步入库，没有手写另一翻译权威。
- 原表情选择器共享 15 项与 Web Composer 25 项通过；图片 atom 的 Markdown/光标
  投影沿原 Tiptap 实现，Web 仅用既有 BFF mediaPaths，Native 使用本人 CLIENT
  IPC 与当前 Relay。撤权清除图片 src 而保留短码和草稿。目录读取暴露原紧凑
  编辑器瞬态 sending/自动聚焦竞态，已改为真实成功回执 revision 驱动收起；
  UNKNOWN、拒绝、未发送新内容都保留展开和草稿，不改夹具延迟掩盖竞态。
  日志 `/volumes/data/kailo/tmp/custom-emoji-picker-20261007.wuIBNx/negative-restored-final.log`
  退出 0。主动恢复旧 src fallback 导致 1 项失败；不递增真实确认 revision 导致
  2 项失败。两次退出 1、原字节恢复 `cmp` 0，之后得到上述 15+25 通过。
- 初次 System suite 因迁移后 i18n 相对路径错误未能加载，已修正后重跑；不能把
  该次仅 Reaction 通过当作整个批次通过。
- 频道窗口与读取消费者合批，Web 5 文件共 50 项通过；随后保留归档前已准入历史
  与关闭旧回调，窗口 hook 最终 14 项通过。原窗口 store 23 项通过。共享、Web、
  Desktop TypeScript 检查均实际通过；先前 Native 快照缺共享副本及真实
  `triggerElement` 类型不一致的失败保留，修复后结果才算通过。日志在
  `/volumes/data/kailo/tmp/timeline-shared.SEF8hh/` 的 `channel-window-final-union.log`、
  `channel-window-restored.log` 和 `channel-window-archived-final.log`。两处窗口
  守卫破坏共 4 项真实失败，原字节恢复后通过；初次直接打开归档频道的既存
  读取缺口没有被本增量冒充解决。
- Core 原线程读取补入既有 kind 40002；查询与签名回执验证使用同一读取闭集，
  不改变 kind 9 的发布和修改目标。NIP-10 祖先、scope、签名、复合游标及授权
  复核继续执行，无 schema/API/Workflow 更改。原 `web_transport::tests` 最终
  30 项通过、1 项忽略，Clippy `-D warnings` 退出 0。禁用 V2 读取 alias 后
  2 项真实失败、退出 101，原字节 `cmp` 0 恢复。日志为
  `/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/workspace-creator.eqWSX8/v2-thread-final.log`。
- 原 `./tools/check-docs.sh ../.design` 在上述受限 SDK 执行退出 0：277 个引用、
  87 实体、115 DD、29 接缝闭合，87 场景均处理，实施与设计 markdownlint 通过。

此时尚无本批浏览器截图、Windows 设备、Mobile、完整检查或部署验收。DM 系统成员
没有已有可用资料读取准入时不伪造可用资料弹窗；设备管理位置标记与系统行回应的
真实宿主写入闭环也不能仅凭共享组件已存在而记为完成。本批不声明“100% 还原”。
Data 当前仅约 1.3 GiB 余量，不启动全仓复制与全量发布构建；没有删除共享缓存或
其他项目数据来腾空间。前次 full 的失败结果不被这次定向检查覆盖。

### 冷开归档频道历史：原读取窗口恢复（2026-10-07）

基准 `23dc25b60b1e059a0a73d6434f42c83bb2ab14e5`；本批仅四个 Web
宿主/检查文件，不改 Core、契约、权限、归档写入或 reaction 区域。

1. 既定权威与源码：REQ-24、SF-BUZ-44 规定 Channel 归档仍可查询历史。
   固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/features/messages/hooks.ts::useChannelWindowQuery` 不因
   archived 禁用读窗口；`desktop/src/features/channels/ui/ChannelPane.tsx`
   的 `isComposerDisabled`、`onOpenThread` 则保留归档禁写。
   这不同于 `.design/03` §2/§4 的 Workspace SUSPENDED：后者拒绝普通
   读写，不能因为本次修复放宽。
2. 调用与根因：原 `useChannelWindow` 在 archived 时提前 return，冷开
   不发 SSE、也不请求历史，分页又依赖 live，产生空白/无限骨架。
   Core `web_transport::query_messages_for` 已使用原
   `ReadTarget::admit` 在读前、读后复查实际成员、Workspace、Tenant、
   会话、身份及 binding；原 Relay REQ 保留归档可读，后端无需修改。
3. 实现与异常：归档只走既有 workspaceMessages/conversationMessages
   GET，复用原 channelWindowResponse、39005/39006 与 store，继续
   精确复合游标；不把读取成功当作 live，不开写入口/通知/已读写入。
   切 scope、解归档、重试与卸载隔离迟到头页；fresh BFF 拒绝清掉旧窗口；
   网络/无效 bounds 显示原错误重试，不伪造空历史或已耗尽。
   ChannelPane 只替换原时间线 loading prop，使签名空窗口显示原空态。
4. 事后验证：既有受限 SDK 4 CPU/8 GiB、无并发工具链，执行 Web tsc
   退出 0，useChannelWindow 20 与 ChannelRead 19 合计 39 项通过。
   SDK-only 禁掉 archived GET 后两个 cold-open 用例真实失败（exit 1）；
   原字节 cmp0 还原后同 39 项再次通过（exit 0）。保留原日志
   `/volumes/data/kailo/tmp/timeline-shared.SEF8hh/channel-archive-final.log`、
   `channel-archive-mutation.log`、`channel-archive-restored.log`。
   本批未构建、未部署、未进行真实 Relay 归档对象浏览器验收；
   单元/DOM 窄验不冒充线上完整业务通过。

## 2026-10-07 固定生产 bundle／原 EmojiPicker 本地双语词库实测

定位权威：沿 REQ-24 原版页面完整恢复及默认中文／英文切换要求，继续复用 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/custom-emoji/ui/EmojiPicker.tsx::EmojiPicker`，不修改其布局。页面实际发现：仅传 `locale=zh` 时 emoji-mart 向 CDN 请求词库，被现有 `connect-src 'self'` 拒绝。修正复用已锁定、已安装 `@emoji-mart/data@1.2.1` 的 `i18n/en.json`、`i18n/zh.json`，没有自制翻译或放宽 CSP。

影响面：共享 `EmojiPicker.tsx` 增加两份固定包词库导入和真实 `i18n` prop，Web/Desktop 的所有既有消费者复用；共享 `tsconfig.json` 开启两宿主原本已有的 `resolveJsonModule`。现有 `custom-emoji-composer.test.tsx` 追加中英切换回归。无契约、Dart catalog、权限、身份、额度、媒体权威变化。

副作用与异常：认证和 BFF 请求全程真实。预览不写消息、不造系统事件、不改变自定义媒体准入；目录 404 不当成成功。本地词库随设备语言切换更新，不依赖公网下载。SDK-only 删除 `i18n` 输入后，新用例真失败，再恢复正式原字节并复跑。默认中文在验收结束时经原设置控件恢复。

实现候选：基准 `23dc25b60b1e059a0a73d6434f42c83bb2ab14e5`，三文件树 `f731a363c2aeaf489a349a7256e8b454572754e1`，private index `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/web-preview-23dc25.KKznS6/candidate.index`。+14/-1，diff --check=0。未提交或部署。

### 实际构建与检查

仅从固定 commit 导出原产物四项输入：`web-client/web/`、`client-kit/ts/contracts/`、`client-kit/ts/platform/`、`collaboration/patches/virtua@0.49.3.patch`，加原 helper／manifest／忽略文件建立小 Git 快照。初始输入约15MiB；既有 SDK `kailo-agent-receipt-xvkujx` CPU4／内存8GiB，复用已有依赖、不 install、不下载、不建镜像。初次 `npm run build`（tsc && vite build）退出0，Vite6.01s；原 helper buildID `sha256:6d3409f071a16ff6d28229500afce1ef9dca3787786cf44911eeb3161b49b581`。发现词库问题后，仅叠加上述三文件再产出校正版，Vite4.93s、退出0，buildID `sha256:745cd482fc1f93289d0913ada04c112f2713f3c844db02c08986c002c5fa7507`。

原构建命令（SDK apps 根）：

```sh
eval "$(python3 -B tools/upstream_manifest.py plan web-client)"
export PLATFORM_BUILD_ID="$source_build_id" VITE_BASE_PATH=/app/
export npm_config_cache=/cache/npm npm_config_offline=true
cd web-client/web
npm run build
```

共享 `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` 退出0。现有 Vitest 4.1.11 不接受旧 `--minWorkers` 参数，首轮命令失败保留在 `emoji-local-i18n-tests.log`，移除该旧选项后以 `--pool=threads --maxWorkers=1` 运行现有文件，7/7通过。SDK 变异将 `i18n` 改为 undefined，新用例1失败／6跳过、退出1（`emoji-local-i18n-mutation.log`）；正式文件原字节还原 cmp=0 后7/7通过（`corrected-production-build.log` 开头），随后校正生产构建0。没有做 Native Rust／Windows 包／全量检查。

### 普通 SSO 和静态预览

复用已有浏览器 `kailo-collab-b911-seam`、受控 seam-verifier 普通 SSO，未新建身份或提权；最终真实 `GET /api/v1/session=200`。没有输出凭据。认证瞬时过期会如实按原登录链重新进入，不绕过 IdP。

初次直接 fulfil HTML 会触发 Chrome Private Network Access，真实 API 被挡；另一次把候选入口内容放在旧入口 URL 导致 ES module 双上下文的 ThemeProvider 报错。这两次都是预览方法失败，非合格页面证据；原记录保留。最终不拦截 document，使原 HTML、CSP、网络地址空间和认证保持真实。仅旧静态入口 JS 响应为导入候选 canonical 入口的一行模块 loader、旧 CSS 引用映射候选 CSS，并以候选 dist 原字节响应其精确静态文件集。API、OIDC、SSE、媒体 BFF 完全不拦截；不运行 dev Vite，不关闭 CSP。原生库／业务代码未在浏览器改写。

真实频道 `/app/channels/ad9a6443-f0a2-47d2-895d-f11b8fef9e38` 的 channel/messages/stream 200，原时间线、头像、日期分隔、hover 操作及编辑器实际可见。中文版打开表情选择器显示“搜索／最近使用／表情与角色／选择一个表情”；通过原设置界面切 English 后显示原英文，再经设置切回中文。打开两种词库的 console error 均0，无 CDN 请求。最终全页面 console 剩2个真实 `/api/v1/custom-emoji` 404（目录读取及重试），说明旧 Core 尚不支持该接口，不能称自定义图片目录端到端通过。

系统行没有伪造截图：当前身份可见主频道真实返回 kind9=24、39005=12、39006=1；继续一页历史只有39006；另一个可读取频道只有39006，第三个目录项读取403。没有任何40099输入，因此系统行的真实页面验收未完成；上述事实不等同于新行组件有问题，也不冒称系统行通过。

截图已逐张使用 view_image 打开，均在下述日志根目录：

- `corrected-channel-zh.png`
- `corrected-emoji-zh.png`
- `corrected-channel-en.png`
- `corrected-emoji-en.png`

日志：`production-build.log`、`corrected-production-build.log`、两份 `*-build-plan.log`、`corrected-channel-zh.json`、`corrected-emoji-zh.json`、`corrected-emoji-en.json`、`final-session.json`、`console-final-redacted.log`。根目录为 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/web-preview-23dc25.KKznS6`。这里只证明固定候选的真实 BFF 浏览器预览；不等于部署，也不是 Windows 验收。

## 2026-10-07 原回应条与真实宿主接线

本批以 `2012d3a2de4e976f82ceed628da8844731eae07d` 为基准，继续恢复同一
固定 Buzz 的 `desktop/src/features/messages/lib/formatTimelineMessages.ts`
回应投影、`MessageRow.tsx::MessageRow` 与 `MessageActionBar.tsx::MessageActionBar`。
原 kind 7/5/9005 事件仍是事实来源，不新增回应表、注册表或执行权威。

1. 权威与影响：原 formatter 的最后合法 e 引用、同作者/emoji 去重、删除过滤及
   最早时间顺序移入共享 `buildMessageReactions`，Native 的可信 actor 解析仍由原
   宿主传入；Web 使用 BFF 验证后的签名者，不信任自报 actor tag。两端共享原回应条、
   三个快捷表情、原选择器与动画，只有媒体解析、本人身份、调用和 UNKNOWN 语义接缝
   不同。Mobile 仅同步原生成器产生的两项词条，不冒称移动端接线已验收。
2. 原消费者接通：普通行和系统行、频道主时间线、频道线程及 Web Inbox 线程传递
   原回应字段和回调；Native memo 恢复原 `reactionsEqual`，避免事件已变而不刷新。
   原 `CHANNEL_AUX_EVENT_KINDS` 恢复 kind 7，线程保留辅助事件，不把它们当正文消息。
3. Web 写入沿原发布准入和审计。UNLIKE 使用本人的原 kind 7 ID，而不是消息 ID；
   重复本人回应逐个撤销。发送前保存原请求及幂等键，确认过的前缀不重复派发；
   刷新后只能观察原 UNKNOWN，相反点击不暗中派发反向新动作。存储失败不派发，
   scope/本人签名者变化隔离旧回执，未知媒体地址不回退为公开 URL。
4. 检查与边界：共享类型检查退出 0；回应 18 项与系统行 7 项通过。SDK-only 断开
   真实快捷回应回调并反转 kind 7 投影，新增四个检查全部真实失败（4 failed、
   21 passed、exit 1）；两文件原字节 cmp 0 还原后 25/25、exit 0。
   日志为 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/message-edit.AGX058/`
   中 `reactions-root-mutation.log` 与 `reactions-root-restored.log`。

Native 首次类型检查发现通用事件类型丢失签名字段和旧导出缺少 TimelineReaction，
已保留泛型输入及原类型导出后退出 0。纯 formatter 检查随后发现从 UI 总入口导入
会加载 emoji-mart 的 CommonJS 组件；改为同一共享纯函数的明确子路径，不修改测试
加载器绕过。原 formatter/equality 实际 10 项通过。Native Inbox 的进一步消费者
修复另行记录；这些检查不能证明 Native Rust 编译或 Windows 安装业务通过。

Web 原 BFF、ChannelRead、ChannelThreadPane、InboxThreadPane、ChannelPane 和
回应 hook 共六文件 57/57，通过类型检查。先前 53/54 的失败是 jsdom 对非 BMP emoji
CSS 属性选择器未选中真实存在的按钮；现比较同一原按钮的精确 aria-label，不减少
真实点击断言。故意丢弃恢复的冻结请求、将 UNLIKE 改指向消息后 7/40 实际失败；
正式字节恢复后四文件 40/40、exit 0。日志在
`/volumes/data/kailo/tmp/timeline-shared.SEF8hh/` 的
`message-reactions-web-final.log`、`message-reactions-mutation.log`、
`message-reactions-restored.log`。独立 Forum post UI 没有在本批恢复。

此批不修改 schema、数据库或 Workflow；Core/Native 发布与实时准入证据见
`web-client/fork/verify/web-surface.md` 的“原回应发布与实时投影接线”。
先前四张浏览器截图只覆盖固定旧候选和词库修正，不覆盖本次回应联合候选。
当前未完成真实跨用户回应联调、完整检查、镜像发布、Windows/Mobile 设备验收，
不把定向通过记为 100% 原版一致或生产就绪。

本批原文档快路径首轮未投递 npm cache，因尝试写 `/.npm` 而退出 1；
保持源码不变，投递既有 `/cache/npm` 及 offline 后，同一受限 SDK 的
`./tools/check-docs.sh ../.design` 退出 0（277 引用、87 实体、115 DD、
29 接缝、87 场景，实施和设计 markdownlint 均通过）。两轮日志分别为上述
`message-edit.AGX058/reactions-docs.log`、`reactions-docs-restored.log`。
另对本 fork 证据文件的直接 markdownlint 调用显示处理零文件，不计为该文件
已实际 lint；没有修改配置或检查器来把跳过冒充通过。

### Native Inbox 原完整回应消费者补回

事后交叉复核找到原 `desktop/src/features/home/ui/InboxMessageRow.tsx`
的回应段不仅缺按钮，还缺 `useInboxThreadContext` 的 kind 7 回读和两次 Inbox
数据转换的 reactions/pending 字段。现在沿原已显示消息 ID，复用原
`relayChannelFilters.ts` 的两个实际过滤函数及原分页界限读取回应、再读撤销；
Kailo 的两跳均保留本人授权 `#h`，不复制第二份消息数据库。
原 HomeView/InboxDetailPane/InboxMessageRow 全链消费真实发布回调与 shared
回应 UI，UNKNOWN 中性显示且禁重复点击；原 mutation 明确关闭自动重试，
scope generation 与卸载隔离迟到 ACK，不刷新另一个用户/频道的页面。

既有受限 SDK 最终 Native `tsc --noEmit` 退出 0，Inbox 转换 13、formatter 6、
memo 5、mutation 生命周期 5，共 29/29 通过。仅在 SDK 破坏 scope/unmount
隔离、Inbox 回应投影及 memo count 后 4 failed/19 passed、exit 1；原字节 cmp 0
还原后同 29/29、exit 0。首次 SDK 旧 .bin/tsc 相对链接失效的
MODULE_NOT_FOUND 已保留，改用同 SDK 已有 TypeScript 二进制，未安装新依赖。
日志为上述 `message-edit.AGX058/native-reaction-final.log`、
`native-reaction-mutation.log`、`native-reaction-restored.log`。
生命周期检查隔离了 hook 与 IPC/React Query 边界，不等同于实际 Tauri/Relay 联调。
Native Rust、Windows 设备和本批部署仍未验收。
