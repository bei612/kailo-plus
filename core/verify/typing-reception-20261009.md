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
- 发消息清除相同签名作者/线程；重复投递普通消息不重新抑制下一次输入。
  交叉复核确认原版 completion 使用可信 Relay 公钥和 `resolveEventAuthorPubkey` 解析代署名作者；
  当前 Web 未投递该可信公钥，本批不盲信事件的 actor/p 标签。
  Relay 代署名消息不能立即清除原作者输入，仍由原 TTL 到期清除，此差异尚未恢复。
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
