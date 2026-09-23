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

`core/verify/seed-identity.sh` 只登记 `.design/03` 已定义的字段。
它不绕过 BFF 的任何判定——BFF 仍按 issuer/subject 查库，查不到照样拒绝。
真实的 Tenant 与成员建立走 Stage 1 的 `TENANT_LIFECYCLE` /
`MEMBERSHIP_PROJECTION` Workflow，不是这个脚本。

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
