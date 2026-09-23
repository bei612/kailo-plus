# 身份链核验：AgentGateway → BFF

对应 `.design/09` 第 1–2 步与 Stage 1 退出门禁中的
「外来身份 header、缺失 header 全部被拒绝」「Core `REVOKING` 在对账完成前即拒绝新动作」。

## fail closed：绕过网关直连 BFF

BFF 只在 `app` 网络，Browser 到不了它；下列请求从网络内部发起，
模拟「网关被绕过」这一最坏情形。

| 请求 | 结果 |
|---|---|
| 无任何身份 header | `403 {"class":"DENIED","reason":"IDENTITY_HEADER_MISSING"}` |
| 伪造 issuer 与 subject | `403 {"class":"DENIED","reason":"IDENTITY_UNKNOWN"}` |

第二条是关键：伪造 header 也拿不到执行身份，因为 subject 不在
`identity.external_identity` 中。没有自动建号，也没有默认 Tenant 兜底。

## 正向：完整 OIDC 登录后经网关访问

登录后带会话访问 `/api/v1/session`，**同时携带伪造的 `x-kailo-oidc-subject: FORGED`
与 `x-kailo-tenant: FORGED`**：

```json
HTTP 200
{"humanIdentityId":"11111111-0000-0000-0000-000000000001",
 "tenantId":"11111111-0000-0000-0000-000000000003",
 "tenantMembershipId":"11111111-0000-0000-0000-000000000005",
 "tenantPrincipalId":"11111111-0000-0000-0000-000000000004"}
```

返回的是从**已验证** subject 解析出的身份，伪造值对结果没有任何影响。

## membership 状态直接控制准入

同一会话下，只改 `identity.tenant_membership.state`：

| 状态 | 结果 |
|---|---|
| `ACTIVE` | `200`，返回解析出的身份 |
| `REVOKING` | `403 {"class":"DENIED","reason":"TENANT_MEMBERSHIP_NOT_ACTIVE"}` |
| `REVOKED` | `403`，同上 |
| 改回 `ACTIVE` | `200` |

`REVOKING` 立即拒绝，不等对账完成——这正是退出门禁要求的行为。
会话本身没有被销毁，拒绝来自每次请求重新解析 membership，
而不是依赖某个缓存或登出动作。

## 核验夹具

上面几节的结果最初用一个手写 ACTIVE Tenant 与成员的脚本取得。该脚本已删除：
现在的核验身份一律由 `core/crates/kailo-core/examples/verify_workspace.rs` 建立，
它复用集成测试的夹具，Tenant、Workspace、两级成员与 Buzz binding 全部走
`TENANT_LIFECYCLE`/`WORKSPACE_LIFECYCLE`/`MEMBERSHIP_PROJECTION` Workflow，
只有 OIDC subject 取自 IdP 里真能登录的核验用户。经网关的整条链由
`core/verify/web-walkthrough.sh` 在真实浏览器里重跑（见
`upstream-patches/buzz-web/verify/web-surface.md`）。

## PlatformSession（2026-09-23）

会话不由 Browser 携带：网关只投影 issuer/subject，Core 据此重新解析身份，再找出
或建立该 `(HumanIdentity, TenantMembership)` 的 active 会话。直接后果是**撤销立刻
对下一个请求生效**——不依赖客户端丢弃任何东西，外面也没有一张需要等它过期的凭证。

实测：

| 步骤 | 结果 |
|---|---|
| 首次解析 | `200`，返回新建的 `platformSessionId` |
| 再次解析 | `200`，返回**同一个** `platformSessionId`；库里仍只有 1 条 |
| 成员经 service API 进入 `REVOKING` | `{"state":"REVOKING","version":2}`；会话同一事务内变为 `REVOKED` |
| 撤权后立刻再请求 | `403`，且不再建新会话（身份解析先失败，走不到建会话那一步） |

一个 `(HumanIdentity, TenantMembership)` 同时至多一条 active 会话。不为同一个人
同一个 Tenant 开第二条，否则「撤销会话」会变成需要遍历的动作，而遍历总有漏网的。

撤会话与 membership 跃迁同事务（`.design/03` §3 要求「进入 `REVOKING` 时立即撤销
其 PlatformSession」）。分两次提交，崩在中间就得到一个已被撤权却还能继续发请求的
会话——而 `REVOKING` 的全部意义就是立刻关门。

过期判定按库里的 `now()`，不按进程时钟：多副本 Core 的时钟不保证一致，用各自的
时钟会让同一条会话在一个副本上有效、在另一个副本上过期。

## 注销（`SS-AGW-OIDC` 的 Kailo 半边）

接缝把注销分成两半：网关清本地 cookie，Kailo 在同一条成功路径上撤销 Core
PlatformSession 并关闭 BFF stream。

**顺序不能反。** 网关的 logout 是短路的——`handle_logout` 返回带 `direct_response`
的 `PolicyResponse`，链路随即中断，请求根本不到后端（`SF-AGW-21`）。先调网关就
再也没机会告诉 Core，PlatformSession 会一直留到过期。已写进 `07` §1。

实测：

| 性质 | 结果 |
|---|---|
| 调 `POST /api/v1/logout` | `200 {"revoked": true}`；会话不再是 `ACTIVE` |
| 已建立的 SSE 流 | 在登记的上界内收到 `closed: session-revoked` |
| 会话已撤后再注销 | `200`——注销是幂等的，重复调用不该报错 |

只撤调用方自己那一条会话：同一个人可能在另一台设备上还开着，注销一台不该把另一台
踢掉。要踢全部是撤权，不是注销。

## 撤权对长连接生效的上界

请求/响应路径每次都重新解析身份，撤权因此对**下一个请求**立刻生效。一条已经建立
的 SSE 流不再经过那条路径，所以它自己按 `BFF_STREAM_READMIT_SECONDS` 回头看。

这个间隔是撤权对已建立流生效的上界，因此是部署登记值而不是常量——不登记它，
被撤权的人能继续收到事件而没有上界。它与 `BUZZ_NIP43_RECONCILE_INTERVAL_SECS`
同类：都是必须被说出来的时间窗。

再准入查不动数据库时关流并给 `readmission-unavailable` 而不是 `session-revoked`：
前者是结果不明，客户端应当重连；后者是确定的撤销，客户端不该重连。把两者混为
一谈会让一次数据库抖动表现成"你被登出了"。
