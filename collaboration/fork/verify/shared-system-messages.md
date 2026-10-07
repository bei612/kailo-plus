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
