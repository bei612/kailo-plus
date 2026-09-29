# SS-BUZ-OPERATOR 接缝证据

## 符号可解析（2026-09-22）

在 `779af8886caae1317b4de962082429867ab61503` 上确认：

| 符号 | 文件 |
|---|---|
| `authorize_operator_request` | `crates/buzz-relay/src/api/operator.rs` |
| `check_operator_replay` | `crates/buzz-relay/src/api/operator.rs` |
| `provision_community` | `crates/buzz-relay/src/api/operator.rs` |
| `relay_operator_api_origin` / `relay_operator_pubkeys` | `crates/buzz-relay/src/config.rs` |

## 三条已实测的性质

`core/crates/kailo-buzz/tests/operator.rs` 对运行中的 Relay 执行：

| 性质 | 结果 |
|---|---|
| audience 不符时在发请求之前失败 | 通过。同一把 operator key 不得服务它不该服务的部署 |
| 签名 URL 用错 origin 时不可能通过 | 通过。origin 是配置而非入站 `Host` 头推导，代理后不会被顶替 |
| 同一 owner 重发幂等、换 owner 被拒 | 通过。前者让「行已建、owner bootstrap 崩溃」之后的重试能收敛；后者是 `REQ-09` 的落点 |

## 上游语义的两处澄清

**`create_only` 不是「存在即失败」。** 字段文档写的是「reject an existing host
instead of converging」，实测并非如此：`create_community_with_owner` 在 host
已存在时会按 owner 再查一次——owner 相同则返回既有 community 并报
`status: "created"`，只有 owner 不同才返回 `HostExists`。

这对 Kailo 是好事而不是问题：真正要防的是两个 Tenant 共用同一协作空间，
而那恰好是 owner 不同的情形。但 Core 不得把 `create_only` 当成通用去重手段，
Tenant 唯一性仍由 `identity.tenant` 的 slug 唯一约束保证。

**owner 不是 operator。** 按 `.design/09`，operator 只负责签名创建请求；
创建后的 relay-level roster 用 Tenant CONTROL 身份。核验最初拿 operator
当 owner，很快撞上每 owner 的 Community 数量上限——上游对单个 owner
可拥有的 Community 数有硬上界。

## 核验残留

核验产生的 Community 无法删除：`audit_log` 的外键挡住了删除，
而那正是 `07-运行与运维基线.md` §4 要求的「Audit 记录不可删改」。
不应为了清理核验数据而破坏这条约束。本地 relay 状态的重置方式是
移除 `buzz-db-data` 卷后重跑 `bootstrap.sh`，不是删审计行。
