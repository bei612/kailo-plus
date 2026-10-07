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
