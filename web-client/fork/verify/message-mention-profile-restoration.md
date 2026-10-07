# 原版提及身份与资料交互共享恢复

关联 REQ-24、DD-39/74/75/77、SS-WEB-RELAY。固定上游为只读
`.references/buzz` 的 `779af8886caae1317b4de962082429867ab61503`，本批基于
main `14a34a5972182f110a5b46296ca105e65ca11e1e`，不改变消息发布、计费或授权权威。

## 全链差异分类

- 共享迁移：`desktop/src/shared/lib/resolveMentionNames.ts::resolveMentionProps`
  原算法移入 `client-kit/ts/platform/src/react/messages/resolveMentionNames.ts`；
  Desktop 原模块 re-export，Web 实际消费同一实现。只调整两条 import，及共享包
  严格索引检查下的三处非空断言；正则必有捕获、唯一集合已有长度判断，运行语义不变。
- 共享迁移：`desktop/src/shared/ui/markdown/MarkdownMention.tsx::createMarkdownMention`
  的 InlineChip、包装样式、标签属性和断行片段进入 `MarkdownMentionChip`，两宿主共用。
  原 Desktop UserProfilePopover 保留；没有新建简化资料卡。
- 已授权治理改造：Web 的频道/话题/论坛提及接到现有 MemberHover、MemberProfilePanel、
  MessageAuthorIdentity 和 MessageAuthorProfile，全部经已有 BFF 资料读取。频道目录提供
  principal 与精确 pubkey，不代替后端授权。私聊必须有对应精确公钥签署的已准入事件，
  以 conversation/event/pubkey 读取，不能仅凭目录成员身份打开资料。
- 缺失需恢复：原 AgentManagementMarker、bot-role 的完整运行时分类仍有既有接缝差异。
  本批没有制造 Agent 标记，也没有宣称 Agent 提及完全等效。Inbox/Pulse 等其他消费者
  的完整提及交互、所有页面/设备的原版一致性，不因本批通过被自动标记完成。

## 实施前四步结论

1. 权威：原版提及交互由上述固定源码决定，Web BFF 与 Desktop 本机凭据边界由
   DD-39/75 决定。复用真实资料读取与原弹层，不建立第二份用户或权限目录。
2. 影响：消息标签解析、共享 chip、Desktop Markdown、Web MessageContent、ChannelPane、
   ChannelThreadPane、ForumPane；现有消息 `p`/`mention`/编辑 snapshot 标签读者复用同源。
   无 schema/API/数据库迁移、无持久化格式变动，原消息与旧客户端兼容；Mobile 未改此链。
3. 副作用：新增交互仅读取资料；不开新发布/重试路径。交叉复核发现旧 Web 按整个目录
   显示名猜身份，以及只取第一把设备钥的实质问题，已改为原版标签消歧及所有已知设备钥。
   无标签、同名歧义不生成可点击资料身份；编辑 snapshot 不借历史通知 p 标签恢复旧身份。
4. 异常：缺成员、读取失败、撤权/连接中断关闭交互；话题不可读不留下旧资料入口。
   私聊没有可证明的精确签名事件时 chip 保持非交互，不猜其他设备或共享身份。
   既有 BFF 的 DENIED/PRECONDITION 等六类错误及资料加载/失败展示不变；没有新执行状态、
   正文复制、UNKNOWN 成功化或副作用对账状态。

## 实际验证

在已有 `kailo-agent-receipt-xvkujx` SDK 的
`/evidence/profile-settings-ortsoo.DRR20F/apps` 执行；实际限额 4 CPU、8 GiB 内存与
memory+swap，执行前可用内存约 30 GiB。只同步选定源码及两宿主的 file-package 副本。

- Web：`vitest run src/features/chat/ui/MessageContent.test.tsx src/platform/ui/ForumPane.test.tsx src/platform/ui/ChannelThreadPane.test.tsx`
  实际 3 files / 21 tests passed，退出 0。包含真实论坛帖子提及键盘打开资料、撤权关闭、
  消息标签消歧及旧媒体/话题行为。保留 React 异步 act 警告，没有隐藏为无警告通过。
- 原 Desktop：`node --import ./test-loader.mjs --experimental-strip-types --test src/shared/lib/resolveMentionNames.test.mjs`
  实际 8 passed，退出 0，覆盖 display/name/NIP-05 别名及引用标签等原消费者。
- 私有 SDK 主动删除 MessageContent 的 renderProfile 消费，10 项中 2 failed / 8 passed，
  退出 1；还原正式源码后同一命令 10 passed，退出 0。正式树不含破坏性修改。
- 首次 Web 加载检查退出 1、tsc 退出 2，原因是 SDK file-package 副本没有同步新 export；
  同步实际包后再验证。共享包首次 tsc 检出原源码三处严格索引问题，按上述有界断言修正。
  最终 shared/Web/Desktop 顺序 `tsc --noEmit` 全部退出 0。
- ChannelPane 原真实消费者 7 passed，退出 0；新增用例实际点按第二设备钥提及，
  核对资料目标为该钥签署的 author event，而不是提及消息事件。私有候选退回只使用首钥
  后 1 failed / 6 passed，退出 1；还原后 7 passed，退出 0，正式与候选 cmp 为 0。
- 原 `tools/gen-platform-i18n.py` 生成并 `--check` 退出 0，本批 Inbox 七项词条投影到 Dart。
  `check-docs.sh` 在同一 SDK 最终退出 0。前两次分别存在旧快照缺六处链接目标、npm
  缓存误指不可写 `/.npm` 的退出 1；同步现有文档并明确复用 `/cache/npm` 离线缓存后
  通过，没有下载新工具、修改正式文档绕过检查或扩大文件权限。

## 发布与视觉边界

本批没有发布新 Web 镜像、Windows 包或 Mobile 包。仍未满足全局 full 退出 0：此前全树
导出因空间压力退出 143；本次实际 `df -h /volumes/data` 仍只剩 3.3 GiB，不再次挤占同一
磁盘导出约 2.52 GB 源码及依赖，也不清理用户数据或共享缓存。窄验不替代全量发布验收。

通过 playwright-cli 正常已登录会话重新打开在线频道并截图，实际打开图片视觉检查：
`/volumes/data/kailo/tmp/buzz-visible-pages-20261007.KFQi8t/20-live-channel-before-batch.png`。
这是仍运行旧 JS 的线上基线，侧栏名称仍为空、组件菜单未出现；不是本批源码的浏览器
验收。不得把它、DOM 检查或消费者通过说成全页面截图完成、Windows 验收或 100% 原版还原。

## 消息复制身份共享恢复（2026-10-07）

本批基于 main `367f1f311b07d0cf3b4212c8d56976ce2c4ab6a4`。固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的完整源码路径及符号为
`desktop/src/features/messages/lib/useMessageMentionIdentities.ts::useMessageMentionIdentities`、
`desktop/src/features/messages/ui/MessageActionBar.tsx::MessageActionBar`、
`desktop/src/features/messages/lib/mentionClipboard.ts::buildMentionClipboardHtml`、
`desktop/src/shared/lib/resolveMentionNames.ts::resolveMentionProps`。

1. 权威与分类：复用原消息 Copy 菜单、原双格式剪贴板构造和既有标签消歧，属于共享迁移；
   Web 原仅取 p 标签的自行实现删除。双宿主消费同一 `resolveMessageMentionClipboard`，
   Desktop 原重复 hook 删除、替换为共享消费者的薄 memo。DD-77 的精确身份与 DD-81
   发布边界保持；没有改菜单、布局或新增业务能力。
2. 影响面：共享 resolver/clipboard → Desktop MessageActionBar 与 Web ChannelPane
   的真实复制回调，话题沿同一回调。读取现有正文、profile、p/mention 和编辑 snapshot，
   无 schema、持久格式、数据库迁移、BFF/Relay 接口或权限变化；旧剪贴板构造调用不传
   mentionNames 时行为保持。Mobile 未修改此消费者，仅同步原路径生成的工作流词条。
3. 副作用：交叉复核捕获同名长标签的前缀误绑：两个 Sam Lee 不可消歧时，不能把
   `@Sam Lee` 复制成另一位 Sam。构造器复用现有 mentionOccurrences 的完整文字范围，
   不另写解析器；仍允许同一消息中独立、无歧义的 `@Sam` 带准确身份。无新权威、动作
   或副作用重试；使用的只是已授权读取的当前消息，不把正文持久存到 Core。
4. 边界：引用标签、大小写公钥、NIP-05/别名、同名限定标签和编辑快照沿原解析；缺身份
   或歧义保持纯文本，不从历史通知标签猜身份。剪贴板失败保留已有错误提示；没有新的
   执行状态或错误码，不把 UNKNOWN 渲染成成功。原 Agent 元数据和 Web 粘贴身份消费
   仍有差距，本批不声称原复制→粘贴与全部 Agent 身份语义已恢复。

验证继续使用上文已有 4 CPU/8 GiB SDK；执行前无其他编译，宿主 available 约 30 GiB、
磁盘余量 3.3 GiB。仅将 main 共享源码和本批明确输入同步到已有候选及两宿主 file 依赖，
不新导出工程、不下载依赖、不构建镜像。

- 共享 `vitest run test/message-row.test.tsx`：最终 11 passed、退出 0；Web
  `vitest run src/platform/ui/ChannelPane.test.tsx`：8 passed、退出 0，真实点开原菜单
  并核对 ClipboardItem 中第二设备钥而非首个历史 p 标签。保留 Radix 异步 act 警告。
- 原 Desktop `node --import ./test-loader.mjs --experimental-strip-types --test src/shared/lib/resolveMentionNames.test.mjs`：
  8 passed、退出 0。集中候选共享包、Web、Desktop 的 `tsc --noEmit` 均退出 0。
- 首轮共享 10 passed；Web 四次夹具失败因同实例替换消息后的 jsdom 零高度虚拟列表未
  渲染消息，仅剩日期头。改为真实新频道 key 挂载夹具后 8 passed；没有修改产品虚拟列表。
  集中类型首轮退出 2 因候选缺已提交 workflow 依赖；同步 main 对应模块后全部通过，
  没有为候选旧文件改正式业务逻辑。
- 实现后私有候选退回仅 p 标签：共享 2 failed/8 passed、Web 1 failed/7 passed，均退出 1，
  明确捕获错误首钥。还原后 cmp 退出 0。交叉复核修正前缀误绑后，再仅在私有候选删除
  文字范围核对：1 failed/10 passed、退出 1，输出错误的 Sam 身份 span；还原且 cmp 0 后
  同命令 11 passed、退出 0。正式工作树从未保留故障注入。
- 原 `tools/gen-platform-i18n.py` 生成及 `--check` 均退出 0，新增唯一工作流
  `workflows.runRecorded` 中英词条同步至 Dart，不手写第二份翻译。
- 同一 SDK 执行 `./tools/check-docs.sh` 退出 0：277 个设计引用闭合，markdownlint
  0 issues，21 篇设计语料自检通过。全树 `git diff --check` 退出 2，报告既有未纳入本批的
  InlineEmojiPopover、emoji、editAttachments、parseImeta 四文件 EOF 空行；不改写这些
  他人修改，不把全树检查报告为通过。

本批全量 diff 尚未闭合；未运行新的 full、浏览器全页面截图、Windows/Mobile 安装包
验收或部署。原 full 空间阻断仍在，窄验与类型通过不代表生产就绪或 100% 原版一致。

## 原版粘贴链的双宿主共享迁移（2026-10-07）

比较基准为 main `43179589eebc9668ba1bab8ff2aa3ebc9705686c`，官方基准仍为 Buzz
`779af8886caae1317b4de962082429867ab61503`。本批直接移动既有实现而非重写粘贴器：
`desktop/src/features/messages/lib/mentionClipboardPaste.ts::handleMentionClipboardPaste`、
`desktop/src/features/messages/lib/normalizeMentionClipboard.ts::normalizeMentionClipboardContent`、
`desktop/src/features/messages/lib/mentionIdentityTrust.ts::partitionMentionIdentitiesByLocalTrust`、
`desktop/src/features/messages/lib/mentionTokenSpans.ts::findMentionTokenSpans`、
`desktop/src/shared/lib/trimMapToSize.ts::trimMapToSize`、
`desktop/src/shared/lib/codeBlockClipboard.ts::getBuzzCodeBlockClipboardText` 在迁移前逐文件
`git show` 对照该固定版本，内容一致；当前 binder 和 paste hook 已有 Agent 元数据及
AgentSnapshot 缺口，本批保留差距记录，不以迁移冒充恢复了该分支。

1. 权威与分类：REQ-24、DD-74/75/77/81，原编辑器 clipboard/token occurrence/generation
   语义共享迁移至 `client-kit/ts/platform/src/react/composer`，八个 Native 文件改为消费
   同一实现；仅 Native code-block 复制保留 Tauri fallback 注入。Web 沿原 rich editor
   使用原 hook，不增加菜单、样式或另一个解析器。严格索引三处有界非空断言适配共享
   TS 编译；原有 200 条上限通过既有常量导出复用，不另定业务限额。
2. 影响面：原 Copy HTML → 原 normalize/mention paste → 可信目录核对 → 原 occurrence
   fence → 原 Composer 提交。立即发送先等待原 binder 结算，同一个 owner 防止并发
   提交；作用域更换、清稿和成功提交撤销旧 claims。无数据库、持久格式、合同、权限、
   Core/Relay 或 Worker 改动；原 fallback 仅宿主剪贴板不同，不绕过 BFF。
3. 副作用：剪贴板 HTML 不可信，身份必须与当前已授权目录中的公钥和名字相符；发送
   再读当前目录，撤权/消失拒绝，不将剪贴板带来的公钥当成授权。目录是已有读投影，
   不是新身份权威。UNKNOWN 仍保留原草稿、附件及幂等键，不盲目重发，不复制正文到 Core。
   交叉复核发现 Web 绑定映射遗漏原上限，已在两个写入点复用原 `trimMapToSize`。
4. 边界：同名标签携带精确身份，伪造键不注册；替换 token 或切换 draft 后旧异步结算
   不认领新文字。超时沿原有有界等待语义；多次立即提交不重复发布，富文本和代码块
   保留原格式。Pulse 的实际 onPublish 消费 humanMentionPubkeys；频道/DM 现有写合同
   尚无该字段，本批不声称它们的人类提及已端到端恢复。Mobile 不改此编辑器消费者。

复用上述已有 4 CPU/8 GiB SDK 与候选，不新建整树、安装依赖或构建镜像。实现后新增
五项 Web 实际编辑器检查；第一次 28 passed/2 failed、exit 1，原因是新 jsdom
ClipboardEvent shim 未接受省略 options，修正夹具后 30 passed、exit 0，没有改产品迁就
环境。首次 Docker 无权限退出 1 后改用已有 sudo Docker 入口；Native type 命令首次
误用父目录不存在的 tsc 退出 127，改用既有 desktop/node_modules 后退出 0。

- 主动仅在私有 Web installed 共享 hook 返回 false，实际 3 failed/27 passed、exit 1，
  捕获原身份粘贴/格式与代码块链被移除；日志保留另一个无返回 mock 引发的异常。
  用 apply_patch 还原、正式/候选 cmp 退出 0。最终 Composer、ChannelPane、ProfileSettings、
  SettingsPane 四文件 56 passed、exit 0（`paste-web-restored.log`）。
- 本批 shared、Web、Desktop 产品 `tsc --noEmit` 均实际退出 0。原生成入口
  `tools/gen-platform-i18n.py` 生成及 `--check` 退出 0，唯一新增工作流 Definition 中英
  词条投影到 Dart，不维护第二翻译源。
- 原 Native 使用 `node --import ./test-loader.mjs --experimental-strip-types --test`
  执行 mentionClipboard、mentionIdentityTrust、mentionPasteBinding、mentionTokenSpans、
  normalizeMentionClipboard、composerLinkPastePipeline 六个既有测试文件，100 passed、
  exit 0；`native-paste-consumers.log` 保存在同一 SDK 的 workflow-native-template.s3JDP1。
  原 Native codeBlockClipboard 独立测试无适用对象，不将 Web 代码块检查冒称该端覆盖。
- `tools/upstream_manifest.py diff collaboration --check` 实际退出 0，984 项 remove_paths
  与当前树一致；补登的是上批已共享迁移并更名的 useMessageMentionIdentities 路径。
  此检查只证明删除登记一致，不证明所有删除已恢复或全量差异已分类闭合。
- 集中候选复验工作流四文件最终 62 passed、exit 0（`workflow-batch-restored.log`）；
  首轮候选两个旧检查文件未同步，31 passed/7 failed，同步已提交的现行检查后通过，
  没有改业务代码绕过失败。共享测试类型检查退出 0。
- 同一候选 `./tools/check-docs.sh` 实际 exit 0，277 个设计引用闭合、markdownlint
  0 issues、21 篇设计语料通过，使用既有 `/cache/npm` 离线缓存。
- 本轮重新执行固定源码整树 `upstream_manifest.py diff collaboration --stat`，exit 0，
  输出 3306 files changed / 35394 insertions / 743941 deletions。此为上游项目目录对比，
  包含跨目录共享迁移、授权治理及仍缺失部分，不是“删掉了多少功能”或完成率；八个
  本批迁移文件逐项追溯如上。全部 3306 处差异尚未逐项验收闭合，不能称全量检验完成。

本批尚无新的全页面浏览器截图、Windows/Mobile 设备或部署验收；完整 full 未重跑，
已有磁盘空间阻断没有解除。原 AgentSnapshot、频道/DM 人类提及和其他全量差异继续属于
未恢复项，不能据本批源码迁移或消费者通过声称生产就绪、100% 原版一致。

## 原版消息代码块复制 UI 共源恢复

固定证据为 `/volumes/kailo/.references/buzz` commit
`779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/ui/markdown/CodeBlock.tsx::MarkdownCodeBlock`、
`desktop/src/shared/ui/markdown/utils.ts::getReactNodeText` 和
`desktop/src/shared/lib/codeBlockClipboard.ts::copyCodeBlockToClipboard`。
本批全引用核对发现：Native 仍有原复制 UI，而 Web `MessageContent` 的
`MESSAGE_BODY_COMPONENTS.pre` 只使用无复制控件的 `MessageCodeBlock`。

四步影响结论：

1. 权威与差异：原复制按钮、图标、Tooltip、样式类、复制中禁用、停止事件冒泡、
   成功/失败 toast、末尾仅去掉一个换行及 smooth corners 属于原样保留；完整
   `MarkdownCodeBlock` 与 `getReactNodeText` 迁入已有 shared message-body；
   Native 只注入原 `copyTextToSystemClipboard`。中文/英文词条是用户授权适配，
   不是改变原布局。Web 缺失的原复制消费者由共享 `pre` 直接接通。
2. 影响面：Web 消息渲染和 Native markdown 都用同一个 UI，语法高亮和主题选择
   保持原调用。复用已共享的 clipboard helper，rich HTML 和 plain text 两种
   MIME 保留原 `data-buzz-code-block` 粘贴标记与 HTML escaping。Native
   utils 保留同名 reexport 供原其他调用者使用；Native clipboard wrapper 在
   UI/粘贴消费者已迁走后无调用，删除整个死路径，来源登记由主线同步。
3. 副作用：只由用户点击复制当前已显示代码；不请求额外正文、不改变消息准入、
   scope、Relay/BFF、契约或数据库，无第二权威。只有剪贴板 Promise 成功才
   提示成功；rich write 失败时沿原 plain-text fallback，最终失败提示错误。
   不将 HTTP/任务结果或未知外部执行转成复制成功。
4. 边界：多行和末尾空行遵循原提取行为，复制不夹带语言标签、按钮文字或高亮
   组件；pending 禁用原按钮，点击不触发消息父层动作。空文本沿原语义复制，
   浏览器无 clipboard API/拒绝访问则原错误反馈，不返回固定成功。Native
   fallback 只在 rich clipboard 不可用/失败后调用；没有新业务错误分类。

实现后在已有 `kailo-agent-receipt-xvkujx` 4 CPU / 8 GiB 候选
`/evidence/profile-settings-ortsoo.DRR20F/apps` 集中验证；先查进程及内存，
只同步自有小文件和共享包的两份已安装副本，没有新增快照或安装依赖。

- Shared：`./node_modules/.bin/vitest run test/message-code-block.test.tsx`，
  最终 5 passed，exit 0。覆盖 pending、精确多行、中文控件、rich HTML/纯文
  内容、原标记、fallback、拒绝时不假成功。
- Web：`./node_modules/.bin/vitest run src/features/chat/ui/MessageContent.test.tsx`，
  11 passed，exit 0。真实 fenced message 渲染后点击原复制按钮，断言系统
  clipboard 收到实际两行正文；原其余消息渲染检查一起通过。
- Native：`../../web-client/web/node_modules/.bin/vitest run tests/settings/MarkdownCodeBlock.test.tsx`，
  1 passed，exit 0。真实 Native wrapper 调共享 UI，实际注入 Tauri clipboard
  边界收到原两行代码；复用 Web 已有工具，不给 Native 安装新测试依赖。
- 私有故障注入：仅把 shared 和两宿主已安装副本里的真正复制调用替换为
  `Promise.resolve()`，保留按钮与“成功”提示；Shared 5 failed、Web
  1 failed / 10 passed、Native 1 failed，均 exit 1。检查实际抓到未复制
  却提示成功，不是只检查按钮存在。随后全部 `apply_patch` 还原，最终
  5 + 11 + 1 通过，正式源码未破坏。

日志在 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`
的 `message-code-{shared,web,native}-{positive,mutation,restored}.log`。
初次 shared 4 项通过后增加 rich payload 实证，第 5 项包含在 mutation 和
最终 restored 检查。产品 typecheck/docs 由主线集中运行，本批未重复全局
构建、发布或新增页面/Windows/Mobile 截图验收，不声明其余原版差异已闭合。

## 人类提及：真实频道消费者与 UNKNOWN 草稿恢复

本段记录主线人类 `mentionPubkeys` 接入后的实际消费者补齐，不另建人员目录或
草稿格式。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/features/messages/lib/useDrafts.ts::DraftMentionRef`、
`desktop/src/features/messages/ui/useDraftPersistSnapshot.ts::useDraftPersistSnapshot`
已保存和恢复 `mentionRefs`。Kailo 共享原草稿 store 已有该字段与读回校验，
但 Web `ChannelPane.tsx::Composer` 原先没有写入、恢复时清空身份绑定，这是
本次实际修复，不以额外测试替代实现。

四步结论：

1. 权威：原输入框/提及匹配共源；当前成员由既有受准入目录给出。人类身份进入
   主线已接通的 BFF/Core 签名准入；客户端选择不代替服务端资源授权。UNKNOWN
   不得因重新挂载、同名、成员更名或列表顺序变化而静默换请求。
2. 数据流：选中身份写原 `mentionRefs`，恢复原 `humanBindings`；发送前通过
   既有 `mentionMatchCandidates`/`mentionOccurrences` 固定键盘输入解析出的
   标签与公钥，保留第一次 pubkey 顺序。原草稿按 identity 和 origin 隔离；
   本修复没有新增格式、迁移、共享正文表或注册表。Inbox 回复候选及转发由
   主线补齐，本段只补相应消费者检查；NewMessagePage 未新增候选。
3. 副作用：每次发送仍重核当前目录是否包含固定公钥，撤权不能删除 mention
   后重新发送。已有 UNKNOWN 若缺旧 refs，且正文/附件/Agent 选择均未改变，
   仅人类身份重算改变则保留原 intent 并呈现 UNKNOWN；不可读旧 signature
   同样拒绝静默重发。没有 intent 的未发送草稿不被该保护锁定；真正编辑正文
   或 Agent 选择仍沿原新请求行为，原消息编辑 UNKNOWN 的严格保护保留。
4. 边界：同名用户显式选择、两个人名互换、目录调序、撤权、跨挂载和旧草稿
   缺 refs 均有确定行为；身份不完整不自动发送，结果不明保留原键。没有新增
   错误类别或把无法确定的原执行宣布失败。仅本机原草稿保存引用；Core 正文
   权威边界不变，Mobile/Native 设备验收没有因此增加。

在原 4 CPU / 8 GiB `profile-settings-ortsoo.DRR20F/apps` 候选运行：
`./node_modules/.bin/vitest run src/platform/ui/ChannelRead.test.tsx src/platform/ui/Composer.test.tsx src/platform/ui/InboxThreadPane.test.tsx src/platform/bff-client.test.ts`。
最终 80 passed（24 + 30 + 13 + 13），exit 0。ChannelRead 真正点击原 picker、
编辑输入框、发送、卸载/返回、人工重试；断言同一 key、正文与完整 pubkeys。
Inbox 检查复用既有 Composer mock 验证真实宿主候选 helper 和频道/DM 转发，
不把该 mock 称为完整编辑器验收；编辑器行为由前述真实 ChannelRead 覆盖。

首次检查 49 passed / 5 failed：旧 exact expected 缺新增空 `mentionPubkeys`，
以及 ChannelRead 清 localStorage 未清原内存草稿缓存使测试串草稿。修正期望并
用既有 `clearAllDrafts` 仅隔离测试后 67 项通过。Inbox 首次 partial mock
缺 `fetchUserState` 导出而无法加载，补齐测试边界后 13 项通过，不归为产品故障。

实现后的私有破坏与还原：

- 删草稿 `mentionRefs` 写入：3 个真实同名/更名/撤权场景失败，exit 1。
- Channel、Inbox 频道/DM 与 BFF DM 故意漏传身份字段：9 failed / 41 passed，
  exit 1，真实消费和协议序列化均抓住漏字段。
- 去掉旧 UNKNOWN 的身份重算保护：旧草稿场景失败，exit 1。
- 单独令 BFF workspace JSON 不写 `mentionPubkeys`：协议检查 1 failed，exit 1。
- 所有私有改动用 `apply_patch` 还原，最终上述 80 项通过；正式与候选的
  ChannelPane、InboxThreadPane、bff-client 内容相同，无变异残留。

日志沿前文证据目录：`human-mentions-consumers-{positive,corrected,restored}.log`、
`human-mentions-inbox-{positive,corrected}.log`、`human-mentions-refs-mutation.log`、
`human-mentions-fields-mutation.log`、`human-mentions-legacy-workspace-mutation.log`、
`human-mentions-bff-workspace-mutation.log`。四侧合同生成与产品类型检查由主线
集中执行，本消费者批次未新装依赖、构建镜像或发布，不声明所有提及场景已完成。

## 频道、私聊及回复的人类提及传递（2026-10-07）

本次沿 REQ-24、DD-74/75/77/81 恢复原消息提及，不增加第二条发送链。
固定 Buzz 来源仍为 `779af8886caae1317b4de962082429867ab61503`；
已共享的原提及解析、选择及草稿 `mentionRefs` 保持唯一消费者实现。
本次发现的断点不是签名器没有能力，而是 Web 发布合同仅携带 Agent
Installation，频道和私聊回复适配器丢弃了人类选择结果。

四步影响结论：

1. 既有原版 UI/解析属于原样保留及共享迁移；BFF 的精确身份准入是授权治理
   改造；丢失的人类发布参数及草稿引用属于缺失需恢复。Agent Installation
   准入不能由人类公钥字段替代。Core 仅保存公开身份引用，不保存消息正文。
2. 影响面为 `WebPublishMessageRequest.mentionPubkeys`、四侧生成物、原
   Web Composer、频道/Forum/线程/Inbox 回复和消息编辑、现有 Core 发布事务
   及原 `IdentityClient` 签名器。`publish_attempt.mention_pubkeys` 在首次
   DISPATCH 与原幂等键一起冻结，重入及并发命中都比对同一字段。Desktop/Mobile
   继续本机签名直连 Relay，未改成 BFF 代签；管理平面边界不变。
3. 发送前核实当前 Tenant 的 ACTIVE HUMAN、全局人类身份、Tenant membership、
   Buzz identity binding 和目的地成员；DM 还匹配实际 participant/projected_keys。
   不接受 Agent 公钥偷渡，不按名称选择凭据，不将目录展示作为服务端授权。
   未知结果仍走原发送记录和对账，不重签另一份消息冒充重试。
4. 缺省字段为空集合，合法小写公钥排序去重；非法值拒绝、撤权拒绝、目的地不符
   拒绝、同键改变身份冲突；删除消息不得携带提及。草稿复用已有 `mentionRefs`
   保存选中的精确身份，重试仍重新校验当前成员，不能因同名、改名或目录调序
   换收件人。旧未决草稿缺少引用且重新解析改变原意图时拒绝自动换键。

迁移为 `20261007220000_publish_human_mentions`：旧行和旧 writer 缺省空数组；
没有旧正文迁移、双权威或新执行状态。回退仅在没有非空冻结提及时允许，防止
丢掉在途/已投递请求的幂等身份。新 Core 可读旧请求；旧 Core 不认识新字段，
不能声称反向业务兼容，发布必须先完成迁移及 Core 更新，再启用同批 Web。

已执行契约生成及证据：`tools/gen.sh` 四侧生成退出 0，`tools/gen.sh --check`
四侧及同源 Mobile 文案全部 PASS；既有 TypeScript 往返 48 passed，Dart
43 passed，Go `go test ./internal/contracts` 退出 0。初次 Go/Dart 默认缓存
目录不可写，按已有 `/cache/go-build`、`/cache/go-mod`、`/cache/pub` 配置后
复验通过；未联网安装依赖。原 `tools/check.sh` 的兼容检查实际对
`contracts-v0.1.0` 输出 `281 个 schema，匹配 3 个历史 schema` 无破坏性变更。
旧发布 tag 只覆盖 3 个早期 schema，此结果不能代替上述 Core/Web 发布顺序。

Core 最终 `cargo test --offline --locked -j16 -p platform-core --bin platform-core
web_transport::tests:: -- --include-ignored --test-threads=1` 实际 34 passed、
0 ignored；Rust `contracts` roundtrip 43 passed；clippy `-D warnings` 退出 0。
隔离测试库事务执行 up/down/up，验证默认空集合、数组含 null、删除携带提及、
已有冻结记录禁止回滚；事务最终回滚，业务 Tenant 和 attempt 均为 0。
私有取消 `found == keys` 准入后，跨租户 DB 反例 0 passed / 1 failed；
还原并重新编译后 34 项通过，正式源码与候选 cmp 为 0。

Core 首轮失败分别为候选仍含旧 Projects 依赖、新增 AGENT 夹具违反原
CLIENT custody 约束，以及复制还原时旧 mtime 复用了变异二进制；均保留
日志，分别同步已入库依赖、改用合法身份状态切换、刷新候选源码 mtime 后
复验，不以修改产品安全边界消除检查失败。日志位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`
的 `human-mentions-{restored-final,roundtrip,clippy,migration,mutation}.log`。
这些是发布组件和数据库边界检查，不是新的真实在线人类频道通知验收。

本批尚未部署。当前浏览器会话实际停留在 SSO 登录页；已截图并打开复核，
该会话登录页仍显示英文，不能据客户端词条生成通过宣称全链默认中文已验收。
不能把这张登录截图算作频道、工作流、Windows 或全页面验收。完整原版差异、
三个外部组件业务、真实多人多 Agent 稳定协作和生产发布仍需各自实际证据。

本轮实际调用根入口 `./tools/check.sh --full` 退出 2，原输出为
`容器执行拒绝：必须由执行配置提供 TMPDIR`，没有进入完整检查，不能计作通过。
现有受限 SDK 专项验证继续复用已挂载缓存；数据盘仅剩约 3.3 GiB，本轮没有
为全量快照或发布清理共享数据、重建镜像或修改资源限制来绕过。

共享画布及本批消息代码合到候选实际包副本后，Web 与 Desktop 各自
`./node_modules/.bin/tsc --noEmit` 最终均退出 0；Web 首轮已如实发现安装副本
仍是旧契约，更新为本批实际生成物后复验，不以修改调用类型掩盖字段缺失。
日志为 `read-receipts-20261007/mentions-{web,native}-typecheck-final.log`。
