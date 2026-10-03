# 2026-10-03 核心实现与在途改动复核

本记录是实现后的审查结果，不新增产品要求、接口或发布门禁。
权威仍是 `.design`；实现、检查、提交和部署分别计数。

## 范围与证据边界

- 唯一工程/Git 根：`/volumes/kailo/apps`。
- 已提交范围：`4b44ac6b266345fbc19e3c315df5c3d9bd0af00b` 到
  `9b2225a2d268f41902621ba0d4b1fd44f3b9a8ee`，82 文件、+8690/-660 行。
- 未提交源码冻结为 Git tree `a1588c071059fc66088f6c8f63777a7e92658b4a`：
  相对上述 HEAD，135 文件、+10020/-783 行，含 10 个新文件。
  它包含历史未收口改动，不能全部归为本次交付。
- 三条并行审查分别核对工程规范、设计符合性、三端与运行投递；根负责人复核
  关键调用路径。审阅全部改动路径清单，深读核心治理与副作用边界，未逐行穷尽
  所有 UI、测试和历史文档，也未重审全部上游源码。
- GitNexus 未调用，没有重建图谱或新增检查工具。审查不是并发故障、真实模型、
  OpenMeter 账单或设备验收；原 full 通过不能外推到本冻结树。
- 冻结期间停止新增功能和配置投递；已执行的提供方守卫变异只完成精确还原：
  真实断言退出 101，还原后同一四项检查退出 0。API 守卫变异未执行。

审查原件位于
`/volumes/data/kailo/tmp/codex-full-review-20261003.G3v7AD/`；
冻结 diff SHA-256：
`785b56099882489de2093478ad63d226997fea8124f9bb01d1f4275aa09c7217`。

## 工程规范轴：1 项 P1

### P1：Desktop REST 未核验原事件终态

`collaboration/desktop/src-tauri/src/commands/messages/unconfirmed.rs:77` 仅将
连接中断与 5xx 视为结果不明；`relay.rs:250` 的成功 HTTP 损坏 JSON 错误没有进入
缓存。Relay 已存储但响应损坏时，重试会重新签名，产生另一个事件 ID。
这是新缓存的缺陷。

`relay/submit.rs:48` 的继承缺陷是只核验 `accepted`，不核验响应的
`event_id == event.id`。错配 ACK 会清除缓存，且 `commands/messages.rs:326`
将错误 ID 交给乐观 UI。两处属于同一终态证据问题。

依据：[工程守则](../../AGENTS.md) 规则 10/15、
[工程基线](../../06-工程基线规范.md) §4：UNKNOWN 不得转为无证据的成功或失败。

## 设计符合性轴：1 项 P1，另有未闭合能力

### P1：Delegation 撤销与到期不收敛在途 Codex turn

`core/crates/platform-core/src/delegation.rs:377` 与 `:462` 仅更新
REVOKED/EXPIRED 并审计，没有取消已关联的 Invocation/Workflow。
`agent_task.rs:945` 对 inProgress 只检查空闲/总时长；首 turn 与回复前的 fresh
检查不能停止正在执行的模型副作用。显式 Task cancel、Tenant 删除和 Capacity
终态对账不是定向 Grant 撤销的替代路径。

依据：`.design/10` §4(3–5)、`17` §6、`05` §8。这是既定要求的部分实现，
本批公开 Grant 管理使缺口可达，不把它全部归为新引入的回归。

### 未闭合能力，不计为新回归

- Agent 工具与主动冷 Memory：`agent_version.rs:240` 拒绝非空 Tool/Skill，
  `agent_runtime.rs:315` 拒绝非空 MCP，`:884` 拒绝 native host 请求。
  入口安全关闭，但尚不满足 `.design/12` §3–4、DD-105 与 `19` §5。
- 实际 RuntimeProfile 目录为空；真实模型绑定、Installation 准入与首 turn
  没有受控运行验收。Codex 二进制存在不等于 Installation 可运行。
- CHECK/outbox/stored 证据已有消费者，真实
  Relay→Temporal→Codex→Gateway→Reply→OpenMeter 全链仍未验收。
  STRICT Reservation 的适用产出方仍未闭合；按 ADR-14，它不泛化为首批 CHECK
  链的开发前提。
- Cells、WeKnora、Wren 尚未集成，是可缺席的业务能力，不阻断平台核心开发。

本轴未确认新增无依据业务范围或第二套上游权威。

## 三端与投递轴：2 项 P2

### P2：未知消息重发被拒后误报确定失败

Desktop `useMentionSendFlow.ts:339` 和 Mobile `compose_bar_widget.dart:472`
先清旧状态，再按本次拒绝渲染失败；底层仍保留原未确认事件。
首次确认丢失、随后撤权重发被拒时，新拒绝不能证明首次未存储。
依据工程基线 §4；属于冻结树中的未提交客户端改动。

### P2：Mobile 回读确认未清除原去重缓存

`compose_bar_widget.dart:111` 收到原事件 ID 后清 UNKNOWN 与草稿，却未结束
`send_message_provider.dart:97` 的未确认缓存。随后用户主动发送相同正文和标签，
仍重用旧 ID，Relay duplicate 接受但没有新消息，composer 却被清空。
已有肯定证据应结束原 UNKNOWN 的生命周期，不能永久吞掉后续新消息。

共享 Web/Desktop TypeScript 消费成立；未量化证明视觉“99%”，未覆盖 Win11
安装/签名/本机持钥与 Mobile 设备验收。

## 实际投递与浏览器观察

沿原项目 `platform-local`、原镜像与唯一 `.env`，仅替换四个目标服务；
没有本轮重编译、全量初始化或数据重置。

| 服务 | 实际 artifact digest | 观察 |
|---|---|---|
| Core | `fd913f5d7078eaad6a6e93e09c33a19d0d4697ef6c98ae88d321f809623a2ae1` | running，healthz 200 |
| Worker | `a69cb46b26fc30c93ae68dc6f3f8274123c4f330572cc3e8222e506b296a73fc` | 原 Task Queue 启动 |
| Web | `66646d2a6bcf46a19852ca182af8a51bf31aa33563fdcecce94e6527ec5e9f3e` | 原 healthcheck healthy |
| Gateway | `14bf9f878fbca870361171331ac4401f7c3fa5cd8168c665ae9061a4b2a674e7` | readiness 200，匿名 native 401 |

在线库仅 forward，53→55 条迁移，退出 0。首次 LAN 请求 curl 7/HTTP000，原因是
9b 的发布绑定仍为 loopback；消费已有 PUBLIC_BIND_ADDR 后，仅重建 Gateway
容器，最终 `/app/`、`/api/v1/session` 为 302。绑定修正未进入 9b，不能称干净
9b 已证明 LAN 可访问。24 个非目标平台容器和 9 个数字人容器身份/镜像/启动时间
逐项未变；不宣称全 Docker 状态没有外部并发变化。

原管理员真实 OIDC 登录后，session 为 200/FULL，workspaces 为 200/空列表，
AgentDefinition 为 200/一条真实 ACTIVE 定义。未创建 Workspace、Version、
Installation、模型 Route 或发起 Agent turn。遗漏必填 workspaceId 的 Installation
诊断请求返回 400，是调用错误，不记为产品缺陷或安装列表为空的证据。

投递原件：`/volumes/data/kailo/tmp/codex-agent-management-deploy-20261003.hX2NKL/`；
浏览器原件：`/volumes/data/kailo/tmp/codex-agent-live-browser-20261003.SSepBZ/`。
临时浏览器容器已精确停止删除，证据保留，不保存口令或会话 cookie。

Core/Worker/Gateway 没有 Docker healthcheck，四服务没有运行资源限额；这是
运行边界，不冒称违反仅针对构建的镜像限额规则。构建容器的有限限额已另核验。

## 结论与接续

确认 2 项 P1、2 项 P2，未确认 P0；不据本次有限审查声称全仓无缺陷。
审查结束后恢复三个不重叠实现窗口：Desktop 消息终态、Grant 撤权收敛、Mobile
未知状态与去重生命周期；根负责人继续收口已有模型提供方与 ReplyPolicy 接入。
实现后沿原检查集中验证并阶段提交，不为每个小改动刷新图谱、重新发布。
这些是既定范围的接续，不是新增规格；实际修复验收另据命令终态登记。

## 审查后实施与验证

原四项审查结论保留，不以随后源码改动改写审查时状态。以下均为先改实际
消费者，再在已有检查入口产生反例证据；没有新建检查工具或扩大产品范围。

| 原问题 | 实际源码修正 | 实现后证据与边界 |
| --- | --- | --- |
| Desktop REST 终态与错配 ACK | 原 REST 发布器核验 ACK event ID；损坏成功响应进入同一原事件 UNKNOWN 缓存 | 10/10；删除 REST 分类守卫实际 1 项失败，精确还原后 10/10。Desktop 原生 Cargo 缺 GTK/WebKit，未执行原生 ACK 联合验收；TS 类型检查退出 2，不记通过 |
| Grant 撤销、到期与在途 turn | 同事务标原 Grant 的 `cancel_pending`；原治理循环及每次 Advance 只取消 exact scope/Workflow/known thread/turn；保留原 usage/holder 终态核验 | 三源 fmt/Clippy 与 6 项检查退出 0；撤销、completed 未回复、UNKNOWN 不得确定拒绝的三个生产守卫删除均断言退出 101，逐次 SHA 还原后通过。真实 Temporal/native/usage 联合 E2E 未执行 |
| 原 UNKNOWN 消息的重发被拒 | 共享 TS 与 Mobile 都保留首次原事件的不明结果，不把随后拒绝当成首次未存储证明 | TS 删除生产保留守卫实际 1 项失败；Mobile 同类守卫删除实际退出 1，原源还原后通过 |
| Mobile 回读后的去重生命周期 | authoritative 原 Relay 回读只确认同事件/身份/会话；结束原缓存，旧 ACK 不清除后续新 intent；原 publisher 同步签名登记后才 await | 原三目标共 162/162、format/analyze 退出 0；删除原缓存回读与 exact event ID fence 的生产守卫分别退出 1，9 源逐字恢复后再次 162/162。未做真实 Mobile 设备验收 |

三条实现窗口的精确差分比较基准为各自开工 before，不与全工作树混算：

- Desktop：6 文件、+190/-57；
- Grant：3 文件、+662/-94（包含只限三源的 SDK 格式调整），上刀固定
  ReplyPolicy 依赖另为 +24/-5，不重复计为本刀新写；
- Mobile：9 文件、+565/-45，必需的原 publisher、结构化错误、共享 i18n
  继承依赖在交接中独立登记，不把无关 sync banner 改动纳入该功能。

原件分别为 Data 临时目录
`codex-desktop-publication-terminal-20261003.RRD0si`、
`codex-delegation-revocation-20261003.TZXNsc`、
`codex-mobile-unconfirmed-lifecycle-20261003.JzlMKC`。
各自自有 SDK 已精确删除；没有删除服务、缓存或业务数据。

模型认证与原生 ReplyPolicy 的实现、四侧生成、原生产守卫反例与开发库旧读链
收缩另见 [接入证据](../../core/verify/model-route-runtime-policy.md)。运行模型发现
与候选 RuntimeProfile 配置不等于受治理 Installation ACTIVE。上述源码修正尚不
解除首个真实 Relay→Temporal→Codex→Gateway→Reply→OpenMeter 全链或签名端侧
验收；阶段提交、完整批次检查与实际部署各以随后回执为准。

## 2026-10-03 13:46 UTC：三端发送与 Version 退役源码批

模型/ReplyPolicy 与 Grant 撤权已普通 push 为
`632ccb1fc887e18687577930190500733a974b88`，27 文件、+1819/-289。
随后私有选定树 `c84d321d533a0d8c15c0b82dd979c06a60013577` 相对此提交为
42 文件、+2465/-134，包含 Desktop/Mobile 原发送链的必需继承实现，不全计为新写。
没有纳入认证、同步横幅或其他无关脏改动；共享 TS 是 Web/Desktop 唯一管理主体。

Version 退役依据设计03 Asset/manage、05 §2.8 与17 §8/§10，复用原 HUMAN
统一 Action、EXPLICIT 确认和既有审计。精确 PUBLISHED Version/Asset 同事务退役，
只清除与它相等的当前发布指针，不选择替代版本、不改正文或 Installation pin。
新安装仍仅接受 PUBLISHED；已持久同 AE 的初始化恢复查原精确版本并允许 RETIRED，
不复用新安装的管理版本门禁，也不放宽 fresh scope/member/permission。
可选 canRetire 缺席不开放入口，Mobile 仍是原只读管理面。

实际集中证据如下，不外推真实业务或设备验收：

- 四侧契约、共享文案、原能力注册表生成和比对退出0，18能力/18封闭 Workflow kind。
- Core fmt/Clippy 退出0，原 binary 70 passed/1 ignored；独立库 bootstrap 未执行。
- 共享包与检查类型退出0，原 pages 103/103。仅私有导出删除 canRetire 缺席拒绝守卫，
  实际102通过/1失败、退出1；逐字恢复后103/103、退出0，生产源 SHA 为
  `cf3594d3e9e92756b41b7aafe24131b98ea97fb27abefa0ed41b8ba5562a69f8`。
- Desktop 干净12路径候选类型退出0、原10/10；Native Cargo ACK尚未执行，
  旧检查 SDK缺GTK/WebKit不代表现有Win11 build stage缺少这些依赖。
- Mobile 干净15路径候选 lock/format/analyze退出0、原三目标162/162；旧快照的三次
  生产守卫变异不冒称本次候选变异，未做真实 Relay/设备/签名验收。
- 退役与恢复6条真实SQL在原55迁移库 BEGIN READ ONLY 中 PREPARE/EXPLAIN退出0，
  随后ROLLBACK；没有执行写入、构造授权对象或把规划结果冒称业务通过。

初次Core格式退出1，机械格式化后通过；随后共享类型因已安装依赖缺Shiki退出2，
从相同选定源码沿原冻结锁安装私有依赖后通过，没有改产品代码或类型规则迁就环境。
初次生成容器使用不存在网络而未运行工具链，随后沿现有Docker网络生成通过。
所有失败原件保留在 Data 目录 `codex-agent-delivery-20261003.mjdwzG`。
正常 pages 原件 SHA 为
`b0c94e9b7c745131e18732e5c89750ee6421e62d19580bdff4614a18f717d184`；
守卫变异/还原原件分别为
`7905964ca6328805336f2da125e70db0d34e4a4329158cd80d9a93be8e221250`、
`cbb29236a11f01ac52e5c6a6340f297a41a08e0903ade9d3cfa3cb30aa72e9f4`。

本批未完整检查、构建、部署或完成真实 Agent 首 turn；旧客户端产物不证明新源码。
运行目录仍空，工具/MCP/主动冷Memory与真实回复/用量链仍关闭或未验收。
