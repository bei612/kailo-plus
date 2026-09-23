# `SS-WEB-RELAY` 的 Core 半边

`DD-39` 把 Buzz Web 的 Relay 边界整体换成 BFF transport：Browser 只发类型化的
query/stream/semantic command，不接收 Relay URL 与 Nostr 私钥，不生成
NIP-42/NIP-98/NIP-44，也不提交 raw signed event 或任意 Relay filter。

这份记录只覆盖 Core 半边。Browser 半边（`buzz-web` 里 `BuzzRelayClient` 的那批
调用点）属于同一个接缝，尚未改造。

## 顺序是固定的

1. 以网关投影的 issuer/subject 重新解析身份并取 active PlatformSession；
2. Workspace 必须 `ACTIVE`，且该 HUMAN 有 active WorkspaceMembership；
3. 以该 HUMAN 的 `BuzzIdentityBinding` 代签发布。

反过来做——先签名再查 scope——就会在 Relay 上留下一条本不该存在的事件，
而事件发出去就收不回来了。

## 实测（2026-09-23）

核验链完全建立在真实生命周期之上：Tenant、Workspace、两级成员都由
`TENANT_LIFECYCLE`/`WORKSPACE_LIFECYCLE`/`MEMBERSHIP_PROJECTION` 产出，不手工
seed 任何 Buzz 事实。因此它同时证明了 **HUMAN 的 Buzz 身份是投影链自己建起来的**。

| 性质 | 结果 |
|---|---|
| 只给正文发布，不给任何身份字段 | `200`，返回 Relay 回传的 64 位 event id |
| 读历史 | 读得回刚发的那条；filter 由 Core 构造，调用方没有提交 filter 的入口 |
| 审计可关联 actor、scope、operation、Buzz event | 四者齐备，`evidence_refs` 含 `BUZZ_EVENT_ID` |
| 正文进审计了吗 | 没有。审计要的是「谁在哪里做了什么」，不是「说了什么」 |
| 撤掉 WorkspaceMembership 后再发 | `403`，立刻生效 |
| 不存在的 Workspace | `403`，与无权限**同一个回答** |

最后一条是有意的：把「这个 Workspace 存在但你没权限」和「不存在」区分开，
本身就是一条可枚举的信息。

## HUMAN 身份的状态机在这条链上闭合

`BuzzIdentityBinding` 是 `PENDING_SECRET → RECONCILING → ACTIVE → REVOKING →
REVOKED`（`.design/03` §2），其中「`RECONCILING` 必须核对 Relay roster」。

因此身份在成员投影时以 `RECONCILING` 建立，**roster 查证通过后**才转 `ACTIVE`。
第一版漏了这一步，表现为 BFF 报「没有 ACTIVE 的 HUMAN Buzz 身份」——一个建起来
但永远用不了的身份。

撤权方向只有 **Tenant 层**把身份置为 `REVOKED`：退出一个 Workspace 不等于退出
Tenant，把身份撤掉会顺手关掉他在其他 Workspace 的协作面。Workspace 层的撤权只
动 Channel roster。

这条规则补上后暴露出核验用例自己的顺序问题：原先是「进 Tenant → 出 Tenant →
进 Workspace → 出 Workspace」。Tenant 撤权既然会撤掉 Buzz 身份，之后的 Workspace
操作就**应该**失败——用例因此改成真实顺序「进 Tenant → 进 Workspace → 出
Workspace → 出 Tenant」。原先那个顺序现实里不会发生，拿它当核验只会验出一个假的
通过。

## CollaborationUserState（`DD-40`）

收藏、静音、已读的唯一权威在 Core，三端共用。Web 上这是必须的——服务端不保留
用户解密私钥，原来的 NIP-44 kind:30078 同步路走不通；原生端本地持钥、自己能解密，
但仍以 Core 为准，那是三端一致与可撤权的要求，不是加密能力的限制。

实测：

| 性质 | 结果 |
|---|---|
| 没设过偏好时读取 | `version: 0`，且**不建行**——读取不产生副作用 |
| 收藏一个可见 Workspace | `200` |
| 拿旧版本再写 | `409`——三端并发改同一份偏好时，后写的不能凭空覆盖先写的 |
| 写另一个键 | 先前的键仍在。用 `jsonb_set` 而不是整体替换：整体替换会让后写的把先写的其余键一起抹掉，而版本号只能发现冲突，发现不了「丢了别的键」 |
| 不可见的 Workspace | `403` |
| `context_key` 既不是 UUID 也不是 `msg:<event id>` | `400`。放开键空间等于给用户状态表开了一个任意写入面 |
| 撤权后再写同一个键 | `403` |

最后一条是「键的合法性在写入时校验，不在读取时过滤」的直接后果。读时过滤会让库里
长期存着一堆指向不可见 Workspace 的偏好，撤权之后它们仍在、只是看不见——而
「看不见」和「不存在」在对账时是两件事。

`msg:` 形式不绑定具体 Channel：它指向一条事件，而该事件所属的 Channel 由 Relay
决定。可见性因此退到「该 HUMAN 至少有一个 active WorkspaceMembership」。更细的
判定要按 event 反查 Channel，那是 stream 面闭合之后才有的能力——这里不写一个
恒为真的检查冒充它。

## BFF stream：snapshot + generation

`apps/02` Stage 1 要求「完整 snapshot + generation 的 BFF stream 恢复」。

实时那一半走 **NIP-42 WebSocket 会话**，不是轮询 HTTP bridge。`.design/09` 第 4 步
把两条路分开：写入与历史查询无状态走 NIP-98，只有实时订阅与 WS-only kind 才需要
该 pubkey 的 WebSocket 会话。用轮询假装实时是一条绕过订阅协议的影子路径——
延迟、重复、漏事件的行为都与真正的订阅不一样，而上层看不出区别。

Community 的绑定同样靠 Host 头：Relay 在 WS 升级请求上按 Host 绑定 Community
（`SF-BUZ-32`），因此握手显式带 Community host，AUTH 事件里的 relay URL 也用它
构造，与 Host 头一致。

实测：

| 性质 | 结果 |
|---|---|
| 首连 | 第一帧就是 `generation`，随后 `snapshot`（含先前发的消息），再 `live` |
| 带对的 generation 续流 | **不重发** snapshot——客户端手里那份仍然有效 |
| generation 对不上 | 重新取 snapshot，而不是从猜测的位置接着读；且服务端给出自己的 generation，不回显调用方的 |
| 撤权后开流 | `403`，流建不起来 |

`generation` 由 principal + channel + WorkspaceMembership 版本三者的摘要构成。
放 principal 进去是必要的：同一个 Channel 上不同人看到的 scope 一样，但撤权只
影响其中一个，而撤权必须让那个人的旧 generation 失效。重新授权创建新 membership
version（`.design/10` §4），因此旧 generation 必然对不上——客户端拿不着一条本不该
继续的流。

用摘要而不是原样拼接：generation 会出现在 URL 与客户端存储里，原样拼会把
principal 与 channel 的内部 ID 散出去。

`live` 帧是历史与增量的分界（NIP-01 的 EOSE）。客户端据此知道「追平了」，在此
之前不必把每条事件都当成新消息去提示。

`closed` 帧带关闭原因：客户端看到通道结束时必须能区分「没有更多事件」与
「连接断了」——前者不该重连，后者必须重连。

会话中途收到 AUTH 挑战时不就地重认证，而是关闭并让上层重建：重认证成功与否无法
让上层知道，订阅在此期间的缺口也无从得知；重建会重新走 snapshot，缺口因此被 snapshot
覆盖掉。

通道满时对上游形成背压而不是丢帧——丢帧会让客户端以为自己看到了完整序列，
那比慢更糟。
