# RB-04 Workflow replay 失败与 Worker 回滚

`07-运行与运维基线.md` §6 第 4 项。确定性约束以 `.design/06` 与 `ADR-04` 为准；Worker 是独立发布单元（`01` §4）。

## 适用范围

当前拓扑的 Application Worker（`worker/`，注册 `ComponentTaskWorkflow` 与 `KAILO_BASELINE`），及其在 Temporal 上的全部在途 execution。

replay 失败有两个发现位置：

| 位置 | 表现 | 后果 |
|---|---|---|
| 发布前：`tools/check.sh replay`（`worker/replay-tests`，对录制的真实 history 重放） | `FAIL`，输出 `[TMPRL1100] nondeterministic workflow` | 阻断发布，没有在途影响 |
| 发布后：新 Worker 接手在途 execution | Worker 日志 `Workflow panic ... [TMPRL1100]`；该 execution 的 workflow task 反复失败 | execution 卡在当前位置不前进，也不失败；Core 投影停在最后一次写回的状态 |

发布后的卡住不改变任何事实：撤权中的实体仍是 `REVOKING`（fail closed），建立中的实体仍未 `ACTIVE`。

## 触发信号

- `tools/check.sh replay` 或 `--full` 的第 5 步 `FAIL`；
- Worker 日志出现 `TMPRL1100` 或 `Workflow panic`；
- Temporal SDK 指标 `temporal_workflow_task_execution_failed` 上升（经 OTLP 到 Collector）；
- `kailo.workflow_ref.oldest_age{projection_state="RUNNING"}` 在依赖都可达时仍持续增长。

## 判定依据

1. 日志中的 `TMPRL1100` 给出 history 事件与重放命令的差异（活动类型、timer、顺序）。差异出现在新发布包含的代码路径上，即判定为本次发布引入的不确定性。
2. 用本次发布的代码对录制 history 跑 `go test ./replay-tests/...`：失败即坐实；通过而线上失败，说明录制 history 没有覆盖线上那条路径，把线上 history 导出补进 `testdata`（见可执行步骤第 5 步）。
3. Activity 选项（超时、重试）的变更 replay 抓不到，也不会引起 `TMPRL1100`；它们不是本 runbook 的对象（`worker/replay-tests/baseline_test.go` 的说明）。

## 可执行步骤

1. **发布前失败**：不发布。修改代码使其对既有 history 确定；需要改变已发布 Workflow 的命令序列时，按 `.design/06` 用版本化分支（`workflow.GetVersion`）让旧 history 走旧路径。重跑 `tools/check.sh replay` 直到通过。
2. **发布后失败——回滚**：Worker 回到上一个镜像，不重新构建：
   - 发布前已记录回滚点（`docker tag <当前镜像> <仓库>:rollback`，或上一个 release 的 digest）；
   - `docker tag <回滚点> <compose 使用的镜像名>`，`docker compose up -d --no-build --force-recreate worker`；
   - 旧 Worker 接手后，Temporal 重试失败的 workflow task，execution 从卡住的位置继续。
3. 确认恢复：Worker 日志不再出现 `TMPRL1100`；卡住的 execution 推进（Core 投影的 `last_event_id` 增大，或实体到达终态）。
4. 修复代码（第 1 步），重新走发布前 replay 门禁后再发布。
5. 线上路径未被录制 history 覆盖时，导出该 execution 的 history 补进 `worker/replay-tests/testdata` 并登记到 `TestComponentTaskReplay`：

   ```sh
   docker run --rm --network <component 网络> <admin-tools 镜像> temporal \
     --address <内部 frontend> --namespace <namespace> \
     workflow show --workflow-id <id> -o json > worker/replay-tests/testdata/<name>.json
   ```

   需要找执行时可按 `KailoWorkflowKind`、`KailoTenantId` 列举（`workflow list --query`）。

## 不可执行的动作

1. 不 reset 或 terminate 卡住的 execution 来「解开」它：terminate 让撤权停在半撤状态并被兜底对账观察为终态、实体随之搁浅（RB-03）；reset 会重做已发生的外部副作用。
2. 不在发布后失败时「向前修复」而跳过回滚：修复版本必须先通过 replay 门禁，卡住期间撤权不会闭合。
3. 不删改 `worker/replay-tests/testdata` 里的录制 history 来让门禁通过——它们是已发布行为的证据。
4. 不以重新构建旧源码代替镜像回滚：两次构建不是同一份产物（`ADR-06`）。

## 完成判据

- Worker 运行的镜像是回滚点或已通过 replay 门禁的新版本；
- Worker 日志没有新的 `TMPRL1100`；
- 卡住期间的 execution 已推进到终态或正常等待态，对应实体状态与投影一致；
- 若线上路径此前未被覆盖，其 history 已进入 `testdata` 并在 `tools/check.sh replay` 中通过。

## 演练记录

2026-09-23，本地拓扑，演练工具 `core/verify/drill-worker-rollback.sh`（Worker 一轮缩短为 `SCHEDULE_TO_CLOSE=30`、`MAX_ATTEMPTS=5`、轮间等待 90 秒，演练后还原）：

1. 开通真实 Workspace；记录 Worker 镜像为回滚点。停 Relay，启动 Workspace 成员撤权，任务进入 `RUNNING CONVERGENCE_PENDING`（Workflow 在持久 timer 上等待）。
2. 把 `membershipLifecycle` 中 SpiceDB 与 roster 两步的顺序交换。发布前 replay 门禁当场失败：`[TMPRL1100] nondeterministic workflow: history event is ActivityTaskScheduled (Converge), replay command is ScheduleActivityTask (ProjectBuzzRoster)`。
3. 仍然构建并发布该 Worker。timer 到期后新 Worker 重放在途 history，日志出现同一条 `TMPRL1100`；Core 投影保持 `RUNNING CONVERGENCE_PENDING`，成员保持 `REVOKING`——卡住，但不失败、不越权。
4. 按镜像回滚（`--no-build --force-recreate`），恢复 Relay：成员 `REVOKED`，任务 `COMPLETED`，WorkflowRef `TERMINAL`。同一个 execution 在回滚后继续跑完，没有重新启动。
5. 夹具拆除，源码与 Worker 镜像还原。
