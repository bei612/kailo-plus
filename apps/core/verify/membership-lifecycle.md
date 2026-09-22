# 成员建立与撤权的端到端核验

对应 Stage 1 退出门禁：

> 成员建立与撤权经 `MEMBERSHIP_PROJECTION`/`MEMBERSHIP_REVOCATION` 完成 SpiceDB
> 与 Channel roster 对账，Core `REVOKING` 在对账完成前即拒绝新动作。

链路：ActionExecution → Core 落 `WorkflowRef` → Temporal Start → Go Worker 执行
→ SpiceDB 关系 → Buzz roster → Core 跃迁成员状态。每一环都是真实实例——真实
Keycloak 令牌、真实 Temporal、真实 SpiceDB、真实 Relay、真实 OpenBao KV v2 版本。

用例：`core/crates/kailo-core/tests/membership_lifecycle.rs`。

## 三个断言面各自独立取证

没有任何一条断言以「Core 返回了 200」为据：

| 面 | 取证方式 |
|---|---|
| 成员状态 | 直接查 Core 库 |
| SpiceDB 关系 | 官方 `zed` CLI 直接问 SpiceDB，**带 `--consistency-full`** |
| Buzz roster | CONTROL 身份直接问 Relay |

不复用 Worker 的 Go 客户端读 SpiceDB：那会让「Worker 说写了」给「Worker 写了」
背书。也不查 SpiceDB 的库表：那绕过 API 的一致性语义。

## 怎么跑

`core/verify/run-integration.sh`。这些用例默认跳过（`KAILO_INTEGRATION` 未设），
不是因为可选，而是因为变量名与产品侧同名：部署里 `OPENBAO_ADDR` 是
`http://openbao:8200`、`SPICEDB_ENDPOINT` 是 `spicedb:50051`，都只在容器网络内
可达。谁 source 过 `deploy/local/.env` 再跑门禁，没有这道开关就会让本该跳过的
用例拿着网内地址去连，以一堆看不懂的失败收场——本仓库已经撞过两次。脚本把
网内地址换成本机发布端口再显式开启。

## 实测结果（2026-09-22，连跑三次稳定）

TENANT 与 WORKSPACE 两个层级各验一遍。两者共用一个 Workflow kind，靠 input 的
target type 区分投影目标（`DD-45`）——只验 TENANT 无法证明 WORKSPACE 那条分支
走得通。

| 性质 | 结果 |
|---|---|
| `PROVISIONING` 启动建立 Workflow | `200`，返回固定 workflow ID 与 run ID |
| 收敛后成员状态 | `ACTIVE` |
| `ACTIVE` 后 SpiceDB 有 `tenant:<id>#member@principal:<id>` | 通过 |
| `ACTIVE` 后 roster 有该 pubkey | 通过 |
| 同一 ActionExecution 重复启动 | `409`；`WorkflowRef` 仍只有 1 行 |
| `REVOKING` 启动撤权 Workflow | `200` |
| 收敛后成员状态 | `REVOKED` |
| `REVOKED` 后 SpiceDB 无该关系 | 通过 |
| `REVOKED` 后 roster 无该 pubkey | 通过 |
| 撤权 Workflow 的任务投影 | `COMPLETED`——工作台上看得到终态 |
| WORKSPACE：`PROVISIONING` → `ACTIVE` | SpiceDB 有 `workspace:<id>#member@principal:<id>`；Channel roster 有该 pubkey |
| WORKSPACE：`REVOKING` → `REVOKED` | 两处都撤掉 |

WORKSPACE 那半边的 Channel 由 CONTROL 身份真实创建，`channel_id` 从 Relay 签发
的 kind 39002 的 `d` 标签取得（`SF-BUZ-33`），不是自造的 UUID——自造的 UUID 会
让 roster 投影发到一个不存在的 Channel 上，而那不会报错。

`REVOKING` 立即拒绝新动作那一半早已由 `core/verify/identity-chain.md` 实测，
不在此重复。

## 探针自己踩了一次它要验的坑

第一版 `zed relationship read` 没加 `--consistency-full`，读到写入之前的
revision，于是报出「Workflow 说成功但 SpiceDB 里没有关系」——一条看起来极其
严重、实际不存在的安全结论。这与 Go 客户端里把默认档位换成 `FullyConsistent`
是同一个坑，只是这次踩在验证工具上。

探针还有第二处问题：它用 `Command::output()` 取 stdout，命令失败时 stdout 为空，
于是「没读到」被当成「不存在」。现在探针在命令非零退出时当场 panic——
**一个坏掉的探针静默返回 false，会伪装成一条真实的安全结论**。

## 准入不在这条路径上

`membership_lifecycle` 端点要求调用方给出一个已持久化且 `gate_state=ALLOWED`
的 ActionExecution，并核对它与该成员同 Tenant。谁可以邀请或撤销成员是 Action
准入路径的结论（Stage 2 的全模型），不是本端点的判断。

核验用例自己建那条 ActionExecution——正因为它在测试里而不在 Core 里，Core 没有
给自己发准入通行证。

## 残留

三个系统都清：Core 库（`task_projection`/`workflow_ref`/`action_execution` 在内
共九张表）、SpiceDB 关系、Relay roster。断言中途失败时前两者都可能已写入，
因此清理走 `catch_unwind` 之后的路径而不是断言之后。连跑后复核为 `0/0/0`，
SpiceDB `relationship read` 为空。
