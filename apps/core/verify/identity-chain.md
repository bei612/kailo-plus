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
