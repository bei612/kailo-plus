# RB-05 投影落后与对账缺口修复

`07-运行与运维基线.md` §6 第 5 项。投影的权威在上游（Temporal history、Relay roster），Core 只存投影与引用（`.design/06` §3.1、`DD-48`、`DD-45`）。

## 适用范围

当前拓扑有三类投影，各有一个 Core 内的对账作业：

| 投影 | 权威 | 对账作业 | 度量 |
|---|---|---|---|
| WorkflowRef 与 TaskProjection | Temporal execution | `workflow_reconcile`：超过新鲜度上界仍非终态的 WorkflowRef 按固定 ID Describe，补写漏掉的终态并标 `observation_gap`，NotFound 按 retention 判定 | `kailo.workflow_ref.nonterminal{projection_state}`、`kailo.workflow_ref.oldest_age{projection_state}`、`kailo.workflow_ref.reconciled{outcome}`、`kailo.entity.nonterminal{entity,state}`、`kailo.entity.stranded{entity}`、`kailo.workflow_reconcile.passes{outcome}` |
| Buzz relay 与 Channel roster | Relay | `roster_reconcile`：以各 Tenant 的 CONTROL 身份读 roster，与已落定的成员事实比对；只度量、不修复 | `kailo.roster.drift{scope,direction}`、`kailo.roster.reconciled{scope,outcome}` |
| ActionExecution 门禁/派发与 ApprovalProjection | Core（门禁）、Temporal（审批） | `governance_reconcile`：只取有一步可做的非终态动作——EVALUATING 超时置 EXPIRED、已允许未派发按预写 ID 重新驱动、APPROVED 待重新准入、consume/invalidate 按固定 Update ID 重发、审批 Workflow 已终结而投影未终结时门禁置 EXPIRED | `kailo.action_execution.open{state=<gate>/<dispatch>}`、`kailo.action_execution.oldest_open_age{state}`、`kailo.governance_reconcile.driven{stage}`、`kailo.governance_reconcile.passes{outcome}` |

周期与上界由 `WORKFLOW_RECONCILE_INTERVAL_SECONDS`、`WORKFLOW_PROJECTION_FRESHNESS_SECONDS`、`WORKFLOW_RECONCILE_BATCH`、`ROSTER_RECONCILE_INTERVAL_SECONDS`、`GOVERNANCE_RECONCILE_INTERVAL_SECONDS`、`GOVERNANCE_RECONCILE_BATCH`、`ADMISSION_EVALUATION_TIMEOUT_SECONDS` 给出。SpiceDB relationship 是成员投影的另一执行点，目前只在每次建立与撤权时由 Workflow 以 `FullyConsistent` 读回查证，没有周期对账。

## 触发信号

- `kailo.workflow_ref.oldest_age` 超过新鲜度上界加一个对账周期；
- `kailo.workflow_ref.reconciled{outcome}` 出现 `TERMINAL_PATCHED`（漏写被补）、`UNKNOWN`、`UNRECOGNIZED` 或 `DESCRIBE_FAILED`；
- `kailo.workflow_reconcile.passes{outcome="FAILED"}` 连续出现；
- `kailo.roster.drift` 任一值大于 0，或 Core 日志 `relay roster 与成员事实不一致` / `Channel roster 与成员事实不一致`（带 Tenant 或 Workspace ID 与 missing、unexpected 计数）；
- `kailo.roster.reconciled{outcome="ROSTER_UNREADABLE"|"CONTROL_UNREADABLE"}` 持续出现。
- `kailo.action_execution.oldest_open_age` 超过 `ADMISSION_EVALUATION_TIMEOUT_SECONDS` 加两个治理对账周期（`WAITING` 除外：它以审批策略的 `expires_in` 为界）；
- `kailo.governance_reconcile.driven{stage}` 出现 `APPROVAL_LOST`、`FAILED`，或 `DISPATCH_REDRIVEN`/`CONSUME_RESENT` 在同一批动作上持续出现；
- Core 审计出现 `event_type=RECONCILIATION`、`result_code=APPROVAL_CONSUME_WINDOW_CLOSED`（已派发而批准拒绝 consume）。

## 判定依据

**Workflow 投影：**

| 观察 | 含义 |
|---|---|
| `TERMINAL_PATCHED` | Workflow 已终结而它自己的终态写回没到达；已按 Temporal 观察补写，TaskProjection `observation_gap = true`，工作台显示 PROJECTION_DELAYED。事实已收敛，只需确认为什么没写回 |
| `NOT_FOUND`（非 UNKNOWN）持续出现在同一条 | Start 结果不明且该 ID 在 retention 窗口内查无：Start 没有到达，发起方需以同一 ID 重试（DD-48）|
| `UNKNOWN` | NotFound 且已超出 retention：无法判定是否执行过，按不明处理，不改写为成功或失败（`07` §4）|
| `UNRECOGNIZED` | Temporal 返回了本版本不认识的执行状态：不猜，停在原状态 |
| `oldest_age` 高而 outcome 多为 `OPEN` | Workflow 在跑，只是慢：按 RB-03 判断是否在按轮等待 |

**roster：**

| 方向 | 含义 | 严重性 |
|---|---|---|
| `unexpected` | roster 上有 Core 认为不应在的公钥 | **fail-open**：该公钥可直连 Relay 发布或读取。P1 |
| `missing` | 已落定的成员不在 roster 上 | fail-closed：该成员无法使用协作面。可用性问题 |

`ROSTER_UNREADABLE` 是 Relay 不可达或快照读取失败，不是漂移；`CONTROL_UNREADABLE` 是该 Tenant 的 CONTROL SecretRef 不可读（RB-02）。

## 可执行步骤

1. **`TERMINAL_PATCHED`**：确认实体已到终态（`kailo.entity.stranded` 未增加）。找出写回为何没到达：Worker 日志中该 workflow 最后一次 `ProjectTaskState` 的失败，常见为 Core 在那段时间不可达。不需要其他动作。
2. **`NOT_FOUND` 持续**：由发起方以同一入口重试（同一 ActionExecution、同一 workflow ID），见 RB-03 第 3 步。
3. **`UNKNOWN`**：记录 workflow ID，按实体判断影响：若实体仍在收敛中且搁浅，按 RB-03 第 4 步升级。不重新 Start 同一 ID。
4. **`DESCRIBE_FAILED` 或 passes `FAILED`**：Core 到 Temporal 的连接或令牌问题。查 Core 日志「Describe 结果不明」「WorkflowRef 对账本轮未完成」，恢复连接后下一轮自动继续。
5. **roster `unexpected`**：
   1. 从日志取 Workspace 或 Tenant ID，查该 scope 下成员事实与 binding 状态，找出多出的公钥属于谁、Core 认为它为何不应在；
   2. 若成员事实是撤销（`REVOKED`）而 roster 仍在：撤权投影没有执行或执行后被逆转。按 P1 升级给实施工程负责人，附 Tenant/Workspace ID、成员 ID 与该成员撤权 Workflow 的 ID 与终态；
   3. 若公钥不属于任何 binding：roster 被越过治理写入，同时检查 Relay 的补丁构建与 `BUZZ_MEMBER_EVENT_KINDS` 是否生效（RB-01）。
6. **roster `missing`**：该成员的建立投影没有执行或被逆转。对照该成员的建立 Workflow 终态；若 Workflow `COMPLETED` 而 roster 仍缺，按缺陷升级。
7. 修复后，下一轮对账的 `kailo.roster.drift` 回到 0 即为闭合。
8. **受治理动作停在非终态**：按 `stage` 判断。`DISPATCH_REDRIVEN` 持续：以该动作的
   `temporal_workflow_id` 查 WorkflowRef 与 Temporal，Start 反复不明时按 RB-03 查
   Core 到 Temporal 的连接；不换 workflow ID、不手工改 `dispatch_state`（`DD-48`）。
   `CONSUME_RESENT` 持续：Worker 未处理 Update（按 RB-04 查 Worker）；批准已由
   Temporal 的 consume 截止失效时，投影到达后门禁不再推进。`APPROVAL_LOST`：审批
   Workflow 已终结而它的最后一次投影没到 Core——门禁已置 EXPIRED，按上面 Workflow
   投影的步骤查写回为何失败；发起者需重新提交（新 operation，新审批）。
9. **`APPROVAL_CONSUME_WINDOW_CLOSED` 的 RECONCILIATION 审计**：动作已按批准派发，
   而 Temporal 在 consume 到达前已按截止失效。实体推进由生命周期 Workflow 正常收敛；
   记录该 operation，检查 `APPROVAL_DISPATCH_MARGIN_SECONDS` 相对 Core 到 Temporal 的
   实际时延是否过小（07 §1）。不改写审批投影或门禁。

## 不可执行的动作

1. 不在对账作业里或手工直接修 roster：roster 变更是 Core 以 CONTROL 签发、由 Workflow 按实体版本查证的投影。直接补写或删除没有 ActionExecution、没有审计，也会让下一次投影的前提失真。
2. 不把 `UNKNOWN` 改写为成功或失败，不删除 WorkflowRef、TaskProjection 或 AuditEvent 以「清理」告警（`07` §4）。
3. 不为消除 `observation_gap` 手工改 TaskProjection：它记录的是「这次终态来自补写」这一事实。
4. 不把 `ROSTER_UNREADABLE` 期间的读数当成一致：读不到的那一轮没有结论。

## 完成判据

- `kailo.workflow_ref.oldest_age` 回到新鲜度上界加一个周期以内，或超出部分都已按上表归类并有处置；
- `kailo.roster.drift` 全部为 0，或非零部分已按 P1/缺陷升级登记；
- 连续两轮对账 `passes{outcome="COMPLETED"}`。

## 演练记录

2026-09-23，本地拓扑：

1. **Workflow 投影漏写**（`core/crates/kailo-core/tests/workflow_reconcile.rs`，随 `run-integration.sh` 运行）：以 Worker 不认识的 kind 启动一个 execution，它在写任何投影前终结；对账在三轮内把 WorkflowRef 置 `TERMINAL`、TaskProjection 补写 `FAILED` 且 `observation_gap = true`。同时核验 NotFound 超出 retention 记 `UNKNOWN`、窗口内不改状态、已终结版本再启动回 409。去掉补写的 gap 标记、去掉 409 判定，各跑一次均当场失败，还原后通过。
2. **roster 漂移**（`core/verify/drill-roster-drift.sh`）：开通真实 Workspace，两轮对账没有关于它的不一致日志；把成员事实直接改为 `REVOKED`（不经 Workflow，模拟 Core 缺陷），下一轮报出 `Channel roster 与成员事实不一致 missing=0 unexpected=1`；还原为 `ACTIVE` 后两轮不再报。同一窗口内 relay 维度没有误报。
3. 度量实到 Collector：`kailo.workflow_ref.*`、`kailo.entity.*`、`kailo.roster.*` 与 Temporal SDK 的 `temporal_workflow_task_execution_failed`，标签经 Collector 允许清单保留。
