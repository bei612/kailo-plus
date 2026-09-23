# RB-07 外部副作用结果不明的对账

`07-运行与运维基线.md` §6 第 7 项。原则以 `DD-48` 为准：每个真实副作用先有稳定幂等键；结果不明不得渲染成成功或失败，也不得盲目重放，只能按该组件已登记的查询接缝收敛（`06` §4 的 `UNKNOWN`）。

## 适用范围

当前拓扑中产生外部副作用的调用，逐个组件：

| 组件与调用 | 幂等键 | 查询接缝 | 结果不明时谁来收敛 |
|---|---|---|---|
| Buzz Relay：BFF 代签的消息发布 | 已签事件的 event id | `/query` 按 `ids` 查（`IdentityClient::event_exists`） | `publish_reconcile` 对账作业，超出时间漂移窗口仍查不到即确定未送达（`DD-81`、`SF-BUZ-40`） |
| Buzz Relay：roster 管理事件（9000/9001/9030/9031） | (scope, pubkey, 目标存在性) | roster 快照（kind 13534 / 39002） | 发起它的 Workflow：每次发送后重读 roster，拒绝与未收敛都按「未收敛」按轮重试（RB-03） |
| Buzz Relay：建 Channel（9007） | Channel id = Workspace id | 该 Channel 的 roster 上有 CONTROL | `WORKSPACE_LIFECYCLE` 的重试：重发同一 id 由 Relay 判为已存在 |
| Buzz Relay：operator 建 Community | (host, owner) | 同一请求重发：同 owner 幂等成功，不同 owner 被拒 | `TENANT_LIFECYCLE` 的重试 |
| SpiceDB：relationship 写入 | relationship 本身 | `FullyConsistent` 读回 | 发起它的 Workflow（Converge 以读回判定） |
| Temporal：Workflow Start | 固定 workflow ID `kailo:<kind>:<tenant>:<entity>:<version>` | 按该 ID Describe | 发起方以同一 ID 重试；兜底 `workflow_reconcile`（RB-05） |
| OpenBao：KV v2 写入 | 无（每次写产生新版本） | 写入响应中的版本号 | 结果不明即当作未写：重试产生新版本，binding 只钉响应里拿到的版本；多出的版本不被引用 |

## 触发信号

- API 响应 `class = UNKNOWN`（`PUBLISH_RESULT_UNKNOWN`），界面显示「发送结果待确认」与操作号；
- `kailo.publish.unsettled`、`kailo.workflow_ref.nonterminal{projection_state="UNKNOWN"}` 或 `kailo.workflow_ref.reconciled{outcome="NOT_FOUND"}` 上升；
- Workflow 投影 `CONVERGENCE_PENDING` 持续（roster 或 SpiceDB 结果不明）；
- Core 日志「发布结果不明」「Start 结果不明」「Describe 结果不明」。

## 判定依据

1. 先定组件：operation 的审计（`action_key`）或 workflow ID 的 kind 指明是哪一行。
2. 再看该行的查询接缝给出的结论，而不是看发起方收到的错误：发起方只知道「没收到确定答复」，结论只能来自查询。
3. 查询自身失败（组件不可达）时没有结论，继续等待；不把「查不到」与「查询失败」混为一谈。

## 可执行步骤

1. **消息发布**：取操作号，按 RB-06 的 SQL 看结论。窗口内等待；超出窗口加一个周期仍无结论时按 RB-06 第 2 步定位。结论为 `NOT_DELIVERED` 时告知用户重新发送；为 `ACCEPTED` 时消息已在频道里。
2. **roster 与 SpiceDB**：不需要针对单个调用的动作。恢复组件可达，Workflow 下一轮以查询判定并继续（RB-03）。
3. **Workflow Start**：发起方以同一入口、同一 ActionExecution 重试，Core 以同一 workflow ID 调 Start；已存在即视为已启动（`DD-48`）。兜底对账会把 Start 结果不明的 `PENDING_START` 观察成 `RUNNING` 或按 retention 判定（RB-05）。
4. **Channel 与 Community 建立**：由 Tenant/Workspace 生命周期 Workflow 的重试收敛；不需要人工动作。
5. **OpenBao 写入**：确认引用它的 binding 钉的是响应中的版本；多出的版本在 `max_versions` 内自然淘汰（`07` §1）。

## 不可执行的动作

1. 不把 `UNKNOWN` 改写成成功或失败：不因为「多半发出去了」补 OUTCOME，也不因为「查不到」提前判定未送达。
2. 不换幂等键重试：换一个 event id 就是另一条消息，换一个 workflow ID 就是第二个业务 Workflow（`DD-48`）。
3. 不以组件管理面绕过查询接缝直接改状态（例如直接改 Relay 数据库、直接改 SpiceDB 数据表、对 Temporal execution 做 reset）。
4. 不关闭或缩短对账作业的等待来「清空」告警。

## 完成判据

- 每个被调查的结果不明都得到了来自查询接缝的结论，或在其等待窗口内；
- 相关度量（`kailo.publish.unsettled`、`kailo.workflow_ref.*` 中的 `UNKNOWN`/`NOT_FOUND`）回到事件前读数，或非零部分都有结论与登记。

## 演练记录

2026-09-23，本地拓扑：

1. **消息发布结果不明，端到端**（`core/verify/drill-publish-unknown.sh`，演练时把 settle 窗口临时调为 90 秒，演练后还原为 960）：停掉 Relay 后经 BFF 发布，得到 `503 {"class":"UNKNOWN","reason":"PUBLISH_RESULT_UNKNOWN","operationId":"164eb3db-…"}`，审计 `DISPATCH/DISPATCHED`；恢复 Relay 后一个对账周期内仍只有 DISPATCH（窗口内不下结论）；窗口过后追加 `RECONCILIATION/NOT_DELIVERED`。真实浏览器走查中同一情形的界面显示「Delivery not confirmed yet … Reference: <操作号>」，草稿保留、消息不进列表。
   演练中发现并修正：走查夹具拆除后，它留下的 DISPATCH 因 Tenant 已删、CONTROL 身份已不在而永远无法查询，会让 `kailo.publish.unsettled` 永不归零。对账与度量改为只看 Tenant 仍在的发布——产品里 Tenant 不会被物理删除，被删的只有核验夹具。
2. **Temporal Start 与 Workflow 投影结果不明**：见 RB-05 演练记录第 1 条（Start 结果不明的 NotFound 在窗口内不改状态、窗口外记 UNKNOWN）。
3. **roster 结果不明**：见 RB-03 演练记录（Relay 停机期间撤权 Workflow 按轮等待，恢复后以 roster 查询闭合）。
4. **审查中发现并修正（非演练产出）**：为 HUMAN 建立 SERVER 托管身份时，OpenBao 写入的依赖不可用曾被报成确定的拒绝（403 → Worker 的 `ADMISSION_DENIED`，不可重试），一次 OpenBao 的短暂不可用就会让成员建立永久失败。现按写入错误分类：locator 与 audience 不符仍是拒绝，其余（不可达、登录失败）是依赖不可用（503，Activity 重试）。与读取路径的既有分类一致；由 `run-integration.sh` 的回归覆盖，未单独演练。
