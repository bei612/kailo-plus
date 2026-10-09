# 原版输入状态接收恢复（2026-10-09）

状态：源码写入；本记录不是部署、完整 typing、Windows/Mobile 或原版全量一致性验收。
主干比较基准为 `3256c3d807361404fdedf571486e6bdc5d7364dd`。

## 权威、影响与差异

- 权威为 REQ-24、DD-75、SS-WEB-RELAY、SS-BUZ-SERVER-CLIENT 及
  `.design/09` 的同身份 NIP-42 实时通道。平台数据、身份、权限、消息正文权威均不变。
- 固定来源为 `/volumes/kailo/.references/buzz` 的
  `779af8886caae1317b4de962082429867ab61503`：
  `desktop/src/features/messages/useChannelTyping.ts::useChannelTyping`、
  `desktop/src/features/messages/ui/TypingIndicatorRow.tsx::TypingIndicatorRow`、
  `desktop/src/features/messages/ui/ComposerActivityAccessory.tsx::ComposerActivityAccessory`、
  `desktop/src/shared/ui/Shimmer.tsx::Shimmer`、
  `desktop/src/features/channels/ui/ChannelComposerActivityAccessory.tsx::ChannelComposerActivityAccessory`、
  `desktop/src/shared/styles/globals/composer.css::.composer-dock--with-activity`。
- 原样保留：指示器 DOM、头像、文字样式、shimmer、活动栏动画和原过期/抑制时序常量。
  共享迁移：组件、样式和临时状态逻辑进入 `client-kit`，Web 从真实频道及私聊页面消费。
  授权改造：实时事件沿原 BFF/SSE 而非浏览器持钥直连；四类文字中英同源；自己的各端公钥
  均过滤；断流/撤权立即清空；过期 completion watermark 回收。原 diff kind 是 40008，
  40002 是已有 V2 消息，不将两者混同。V2 同样清除对应输入状态。
- Core 仅在原实时订阅的 kind 集中增加原生 20002，沿既有签名验证、唯一频道标签、
  会话/成员/绑定重验。历史 snapshot/query、游标、数据库、Action/工具注册及发送路由不变。
  输入事件不进入消息历史、通知或长期去重 ID 集合；没有增加连接、发布入口或另一状态权威。

## 边界与异常

- 零条输入无可见活动栏；超期按原 8 秒逻辑清除，刷新保留初次出现顺序；线程输入不冒充主频道输入。
- 发消息清除相同作者/线程；重复投递普通消息不重新抑制下一次输入。
  后续共源补齐沿原 `resolveEventAuthorPubkey` 解析代署名作者；具体信任来源及验证边界见下节，
  不以消息自身的 actor/p 标签证明 Relay 身份。
- 新 scope 不读旧 scope 临时状态；snapshot、断线、结束、撤权均清空；旧 SSE 回调沿原 generation/active
  防护拒绝。已暂停/归档不展示临时输入，未知 kind 不改变输入状态。
- 无新增写副作用、审批、额度预留或结果不明状态；上游拒绝/不可用沿原 `apps/06` §4
  错误分类与流关闭原因呈现，不将重连显示为成功，不重新发布任何事件。

## 实际验证及未覆盖范围

使用原 `kailo-agent-receipt-xvkujx` SDK，实际 4 CPU、8 GiB memory、8 GiB memory+swap，
镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。
日志目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/typing-20261009.EmOaaz`。

原 Node 入口：

```text
node --import ./test-loader.mjs --experimental-strip-types --test src/features/messages/lib/typingState.test.mjs
```

- 首次 `positive.log`：缺 TypeScript 私有安装输入，exit 1、0 项用例启动；没有改源码绕过。
- 复用同容器既有 Native 依赖，`resolved-positive.log`：4/4、exit 0。
- 删除私有候选真实 `receiveTypingEvent` 的频道 guard，`negative.log`：3 通过、1 失败，exit 1。
  失败为跨频道输入被实际保留；不是检查脚本主动报错。
- 恢复原字节后 `restored.log`：4/4、exit 0；最后核对原 diff kind 后
  `final-restored.log`：4/4、exit 0。SDK 副本与正式源码已做 `cmp`。
- 既有 `useChannelWindow.test.tsx` 中追加真实流接收、过期、撤权/断线、重复消息场景；
  Core 原 live-event 检查追加 20002 的签名/频道和 kind 集断言。
  此记录写入时，上述 DOM 与新增 Core 断言尚无运行通过证据，不算通过。
- 并行共享视频批的冻结源码包含本批输入状态消费者：Web 生产类型检查退出 0；
  完整共享包使用原 tsconfig 检查退出 0（96034），不是只检查少数入口；
  Dart 同源词条检查退出 0（76752）。这些检查不替代运行时和浏览器验收。
- DOM 检查 62827 退出 1：MessageContent 与 useChannelWindow 的两个 worker
  均启动超时，150.10 秒、0 项用例运行；新增 DOM 场景没有通过证据，不盲目重开。
  正在进行的全量检查固定为先前 331fdcb 提交，不覆盖本批。
- 未部署，没有本批浏览器截图或 Windows/Mobile 验收；Web 发出 typing 的 WS-only ACK/UNKNOWN 链、
  Native typing 恢复、线程活动栏及 Agent 活动内容仍有缺口，不能声明完整功能已恢复。

## 代署名作者共源补齐（2026-10-09）

比较基准 `e8e4eabd04bb2fad4c22457238722b568fdcc09f`，权威仍为上述 REQ-24、DD-75 接缝。
固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`desktop/src/shared/lib/authors.ts::resolveEventAuthorPubkey` 迁入共享 `messages/authors.ts`；
仅把 normalizePubkey 导入改为既有共享同语义函数，Native 原路径 re-export，原调用方不改行为。
未新增页面、身份注册、权限权威、数据库字段或服务 API。Web 原 BuzzEvent 类型只补记实际原生签名字段；
缺字段仍回退签名者，不能相信代署名。

- 写入方仍是 Relay 原事件；Core `stream.rs` 的 snapshot 经
  `web_transport.rs::verify_message_page` 验签、唯一 bounds/频道校验及 signer=window_author 约束，
  发出前再次读取同一绑定的 Relay 身份。Web 仅在原 `parseChannelWindowResponse` 接受快照后使用
  其中 39006 的 signer；不是从普通消息、p 或 actor 标签推测身份。
- 共享 `receiveTypingEvent` 只对 completion 使用原作者解析与签名校验；20002 仍按原 signer。
  身份缺失/错误、缺签名、篡改内容不清除被声称作者；跨频道拒绝不变。
  snapshot 重置、closed/interrupted/ended 清空信任身份与临时输入；新 scope 使用新闭包，
  原 generation/active 防护保留。没有新副作用及 UNKNOWN 终态判定。
- 原 SDK 4 CPU/8 GiB，日志目录
  `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/typing-author-20261009.DZWHvR`。
  原 Node 入口运行扩展后的 `typingState.test.mjs`：`positive.log` 6/6，exit 0。
  私有候选删除真实 signer=relay 条件：`negative.log` 5 通过、1 失败，exit 1；
  错误身份能清除被冒认作者的输入，负向实际捕获。随后还原，正式与候选 `cmp` exit 0。
  `restored.log` 还原后重跑 6/6，exit 0。
  固定上游 `git show` 仅替换 normalizePubkey 导入路径后与共享文件 `cmp`，exit 0；
  本批拥有的文件 `git diff --check`，exit 0。
- Web 原 DOM 文件追加快照 signer 更换、重连后的原 Relay 不再被信任场景。
  当前未运行该新增场景；本批类型检查随共享 UI 批集中进行，尚无结果。
  Wren 队友交叉源码复核未发现新增阻断；不是浏览器、全量检查或部署验收。
