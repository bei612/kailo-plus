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
