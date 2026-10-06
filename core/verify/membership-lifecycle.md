# 成员建立与撤权的端到端核验

## 2026-10-06：频道创建原生元数据接回（源码与窄验）

本节不是下方历史端到端验收的重跑，也不表示完整频道表单已经恢复。

- 权威：REQ-24、DD-01/45/80；固定 Buzz
  `779af8886caae1317b4de962082429867ab61503` 的
  `desktop/src/features/sidebar/ui/CreateChannelFormFields.tsx::CreateChannelFormFields`、
  `desktop/src/features/sidebar/lib/useCreateChannelForm.ts::useCreateChannelForm`、
  `desktop/src/features/channels/ui/channelFormStyles.ts` 与
  `crates/buzz-relay/src/handlers/side_effects.rs::handle_create_group`。
  description 与 stream/forum 都是原生已有能力；临时频道到期是 archive，
  原模板则包含 canvas/personas/teams，不是频道类型的别名。
- 影响面：Web/Desktop 共用原 Input、字段样式与 description；频道入口不再要求
  原版没有的 slug 输入，以既有创建意图幂等键提供稳定唯一 slug；管理页仍允许
  自选可读 slug。四侧 `ActionCommand.workspaceChannel` 进入原 Params、参数散列
  与 ActionExecution，既有 Workspace Lifecycle provision 从原动作读取它，再由
  CONTROL 发布 9007。没有新建 metadata 数据表、Workflow kind 或正文存储。
- 副作用：建立绑定前回读同一 Channel 的签名 39000，逐项比较原生名称、类型、
  描述、private 与未归档状态。duplicate 只表示 ID 存在，不代表元数据一致；
  缺失、重复/损坏标签、异 scope 或未收敛值均不登记成功绑定，仍走原重试/对账。
  非 workspace.create 携带该参数被拒；创建者 membership 与现有投影顺序不变。
- 边界：旧命令缺 workspaceChannel 时保留 stream 与 slug 原始意图，避免旧在途
  创建重试时把旧 Channel 误判为新的 name；新命令用 name 显示名。空描述省略，
  enum 只含 stream/forum，不能借创建表单产生 DM/workflow Channel。
  UNKNOWN 仍保留整份原命令及幂等键，description 一并锁定；得到原 operation 后
  才清空输入，HTTP 202 不渲染为频道就绪。没有引入新的生命周期状态或迁移。

在既有受限 SDK（4 CPU、8 GiB memory/swap、uid 1000）中的独立执行副本
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/channel-metadata.xjOQiU`
实际运行：

```text
bash tools/gen.sh
OK dart / rs / ts / go；退出 0
cargo clippy --offline --locked -j16 -p platform-core --bin platform-core -- -D warnings
Finished dev profile；退出 0
cargo test --offline --locked -j16 -p platform-core --bin platform-core workspace_channel_tests
test result: ok. 1 passed; 0 failed
cargo test --offline --locked -j16 -p contracts --test roundtrip
test result: ok. 16 passed; 0 failed
tsc --noEmit -p tsconfig.test.json && node --test --experimental-strip-types test/roundtrip.test.ts
tests 17; pass 17; fail 0
dart test test/roundtrip_test.dart
+17: All tests passed!
go test ./internal/contracts
ok apps/worker/internal/contracts
cargo test --offline --locked -j16 -p collab-bridge --test bridge --no-run
Finished test profile；测试可执行文件生成，退出 0
```

四侧同时覆盖本批私聊 preference 样例，不把共同生成物归为单人独占产物。
仅在 SDK 的 TypeScript 往返重建中移除 description，实际 `pass 0; fail 1`，
输出明确指出 description 丢失；恢复后 17 项重新通过。集中运行私聊读取 fence
与 transport 的 1+7 项通过；把私聊 same_admission 暂改为恒真时实际 0/1 失败，
逐字恢复后再次 1+7 通过。
另在 SDK 的真实 `governance::parse_command` 中暂把 workspace_channel 置空，
元数据断言实际退出 101（0 passed; 1 failed，Option::unwrap on None）；恢复正式
源码后同一 workspace_channel_tests 再次退出 0（1 passed; 0 failed）。

失败原文边界：第一次生成因 SDK `/.dart-tool` 无权限退出 255；仅把该容器的
工具状态目录链接到现有 Data owned cache 后恢复，未修改 HOME 或安装新 SDK。
生成副本初缺 i18n 输入、Core 副本初缺 Gateway proto 分别退出 1/101，补齐实际
消费源码后再运行；首轮 Clippy 的 single_match 已重构为 if let，两个无调用旧
transport wrapper 由对应实现者删去，不屏蔽 lint。

本子任务没有开启 PLATFORM_INTEGRATION：新增真实 Relay forum/description
及重复 ID 错元数据用例只完成编译，未以未执行的集成用例宣称协议验收。
租户公开目录/治理加入、TTL 到期与 Core 收敛、完整原模板以及 Forum 页面入口
均仍有缺口；本批不生成无效选项，不把缺口降为产品排除。共享页面交由同批
前端集中验收；完整 check、设计独立提交、apps 提交/push 与部署由批次负责人
分别记录，不能沿用上一批绿灯作为本批通过证据。

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

## 搁浅之后的重跑（2026-09-24）

生命周期 Workflow 被确定拒绝（`FAILED`）后，实体停在 `PROVISIONING`/`REVOKING`，而驱动它当前版本的固定 workflow ID 已经终结，再 Start 只会得到 `409`。重跑入口 `POST /service/v1/tasks/rerun`（`core/crates/kailo-core/src/task_rerun.rs`）按 `.design/06` §9「`rerun` 创建新 ActionExecution/Workflow，不改写旧 history」实现：旧 Workflow 必须 `TERMINAL` 且为 `FAILED/CANCELED/TERMINATED/TIMED_OUT`；Core 经 WorkflowRef 找回原 ActionExecution，核对原 target 与固定 Workflow ID 的实体、同 Tenant；新 ActionExecution 必须 `ALLOWED`、同 Tenant/Workspace，`target_id` 是原 ActionExecution ID 而非实体 ID；实体版本 +1、新 WorkflowRef 与 `RERUN_ACCEPTED` 审计同事务落库，然后交给原来的启动核心（`start_scope`/`start_membership`）以新版本的固定 ID 启动。同一 ActionExecution 重发回答同一个新 Workflow。

`cargo test -p kailo-core --test scope_lifecycle` 的 `stranded_workspace_is_rerun_with_new_version` 以「Tenant 就绪前建立 Workspace」得到真实的搁浅，再验上述每一条拒绝与重跑后的收敛；`core/verify/drill-task-rerun.sh` 按 RB-01 第 7 步的命令逐条演练，结果记在 RB-01 的演练记录里。

2026-09-25 收紧内部入口：上述 ActionExecution 每次调用（包括同键重发）都须为 `task.rerun` 且仍为 `ALLOWED`，不能把同目标的 `scope.provision` 准入串用，也不能凭后来已撤销的准入重启。真实 Core、Temporal、SpiceDB、Buzz 链路的 `stranded_workspace_is_rerun_with_new_version` 为 `1 passed; 0 failed`；用例主动投递同目标的错误 action key 与撤销后的同键请求，均得到 `403`，正确重跑仍以新实体版本收敛。此入口仍是 service API，不是用户可见的 BFF 控制；在 Catalog 登记 Governed Action 与用户准入链闭合前，任务页不显示重跑按钮。
