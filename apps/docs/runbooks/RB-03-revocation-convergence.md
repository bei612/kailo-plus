# RB-03 撤权收敛未完成

`07-运行与运维基线.md` §6 第 3 项。撤权语义以 `DD-45`、`.design/09` 与 `.design/10` §4 为准：Core 先进入 `REVOKING` 并立即拒绝新动作，Workflow 再撤 SpiceDB relationship 与 Buzz roster，全部查证后才 `REVOKED`；投影失败保持 fail closed。

## 适用范围

三类撤权中当前拓扑实现了两类：

| 类别 | 实体与状态 | 驱动它的 Workflow kind | 执行点 |
|---|---|---|---|
| membership | `TenantMembership`、`WorkspaceMembership` 的 `REVOKING` | `MEMBERSHIP_REVOCATION` | SpiceDB tenant/workspace relationship；relay roster 或 Channel roster |
| binding（原生设备公钥） | `BuzzIdentityBinding` 的 `REVOKING` | `BUZZ_IDENTITY_PROJECTION` | relay roster 与此人全部 Channel roster |
| delegation | — | — | 无适用对象：DelegationGrant 属于 Stage 5（Agent），当前拓扑没有这一实体 |

`REVOKING` 期间的安全边界：经 BFF 的一切动作已被拒绝（会话与流在进入 `REVOKING` 的同一事务里撤销）。**尚未关闭的是原生端直连 Relay**——在 roster 移除查证之前，该 pubkey 仍能直连发布（`DD-75`）。因此撤权不闭合就是一个仍在生效的授权。

## 触发信号

- `kailo.entity.nonterminal{state="REVOKING"}`（`entity` 为 `tenant_membership`、`workspace_membership`、`buzz_identity_binding`）持续不降；
- `kailo.entity.stranded` 对上述任一实体大于 0；
- 工作台投影 `projection.task_projection.waiting_reason = 'CONVERGENCE_PENDING'`：一轮 Activity 重试已耗尽，Workflow 在等下一轮；
- `kailo.workflow_ref.oldest_age{projection_state="RUNNING"}` 超过一轮的时长（`WORKER_ACTIVITY_SCHEDULE_TO_CLOSE_SECONDS` 加 `WORKER_CONVERGE_ROUND_INTERVAL_SECONDS`）；
- Worker 日志「本轮收敛未完成，等待下一轮」。

## 判定依据

取该实体当前版本的 Workflow（ID 为 `kailo:<kind>:<tenant>:<entity>:<version>`，`DD-48`）：

```sql
select w.projection_state, t.status, t.waiting_reason, t.observation_gap
from projection.workflow_ref w left join projection.task_projection t using (workflow_id)
where w.workflow_id = '<id>';
```

| 观察 | 判定 |
|---|---|
| `RUNNING` + `CONVERGENCE_PENDING` | 依赖暂不可达或 roster 快照落后。Workflow 在按轮重试，不会自己放弃（`.design/06` §5.1 的每轮上界，`DD-45` 的对账闭合） |
| `TERMINAL` + `FAILED`，实体仍 `REVOKING` | 搁浅：Workflow 被 Core 的 4xx 确定拒绝后终结（`CORE_REQUEST_REJECTED` 或 `ADMISSION_DENIED`）。这是缺陷或前置条件被破坏，不是暂时故障 |
| `TERMINAL` + `observation_gap = true` | Workflow 自己的终态写回没有到达，兜底对账按 Temporal 观察补写（RB-05） |
| 找不到该版本的 WorkflowRef | 撤权 Workflow 从未启动。发起方的调用拿到了 503 且没有以同一 ID 重试 |

依赖是否可达：Relay `GET <relay>/_readiness` 为 200；SpiceDB 容器 healthy；Core service API 可达。

## 可执行步骤

1. **`CONVERGENCE_PENDING`**：恢复不可达的依赖（Relay、SpiceDB 或 Core）。不需要任何针对该 Workflow 的动作——下一轮自动继续，投影收敛后 Core 跃迁到 `REVOKED`。依赖恢复后在一轮加 `VERIFY_CONVERGE_BOUND_SECS` 内应观察到终态。
2. **roster 快照落后**（依赖都可达而仍在等待）：Relay 的 roster 快照在 `BUZZ_NIP43_RECONCILE_INTERVAL_SECS` 周期内重建（`SF-BUZ-34`）。等待不超过该周期的数倍；超过时按第 4 步升级。
3. **Workflow 从未启动**：由发起方以同一 ActionExecution 重试同一入口（设备撤销：再次 `DELETE /api/v1/identity/client-keys/{pubkey}`，Core 按原 ActionExecution 与同一 workflow ID 续起）。
4. **搁浅**：从 Worker 日志中那次 4xx 的 Core 响应找出拒绝原因并修复，然后按 RB-01 第 7 步重跑：成员保持 `REVOKING`（门一直关着），版本 +1，以新 workflow ID 重走撤权链。原因修复前不重跑——同样的拒绝只会再得到一条 `FAILED`。

## 不可执行的动作

1. 不直接把实体改为 `REVOKED`，也不把它改回 `ACTIVE`：前者伪造了一次没有发生的 roster 移除，后者恢复了已撤销的授权（`.design/10`：恢复访问必须建立新 membership version 并重走建立对账）。
2. 不用 Temporal CLI 终止（terminate）或重置（reset）撤权 Workflow：终止会让它停在半撤状态，而兜底对账会把终止观察为终态、实体随之搁浅。
3. 不直接向 Relay 发 roster 事件或改 SpiceDB relationship：它们是 Core 以 CONTROL 身份签发、由 Workflow 查证的投影，手工写入没有查证也没有审计。
4. 不为了「让撤权快点完成」调大一轮的重试上界或关掉轮间等待——那只改变重试节奏，改变不了依赖不可达这个事实。

## 完成判据

- 实体为 `REVOKED`，其 Workflow `TERMINAL` 且 `COMPLETED`；
- 执行点已查证：该 pubkey 不在 relay 或 Channel roster 上（`IdentityClient::roster`），SpiceDB 上没有对应 relationship（`zed relationship read --consistency-full`）；
- `kailo.entity.nonterminal{state="REVOKING"}` 与 `kailo.entity.stranded` 回到事件前的读数。

## 演练记录

2026-09-23，本地拓扑，演练工具 `core/crates/kailo-core/tests/drill_revocation_outage.rs`（`cargo test -p kailo-core --test drill_revocation_outage -- --ignored --nocapture`）。演练时把 Worker 的一轮缩短为 `SCHEDULE_TO_CLOSE=30`、`MAX_ATTEMPTS=5`、`ROUND_INTERVAL=15`，演练后还原为 600/20/60：

1. 建立一个真实 Workspace 与成员（ACTIVE，已在 Channel roster 上），**停掉 Relay**，置 `REVOKING` 并启动 `MEMBERSHIP_REVOCATION`。
2. 16 秒后工作台投影出现 `CONVERGENCE_PENDING`；此时成员 `REVOKING`、任务 `RUNNING`——一轮耗尽没有让 Workflow 失败。
3. **启动 Relay**，等它就绪后 6 秒成员 `REVOKED`，任务 `COMPLETED`，WorkflowRef `TERMINAL`。
4. **反向演练**：把 Worker 改回「一轮耗尽即失败」重建后再跑，演练在等待 `CONVERGENCE_PENDING` 处超时失败；还原后通过。
5. 本次演练的真实 history（含失败的 Activity、持久 timer 与下一轮成功）录入 `worker/replay-tests/testdata/component_task_revocation_round_wait_history.json`；把 Worker 的轮间等待配置为零值时，replay 在该 timer 处报 nondeterministic。
6. 演练暴露的问题已修：夹具清理在 Relay 刚启动、尚未就绪时归档 Community 失败。演练工具改为 Relay 就绪后再继续；夹具清理改为先完成库表清理、最后再报告归档失败，避免一次 Relay 侧失败让 Core 库留下整组残留。
