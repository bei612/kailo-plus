# Task rerun 的 Temporal 终态证据

2026-09-25。范围是内部 `task.rerun` 准入；不宣称三端任务控制入口已开放。依据为 `.design/02` DD-48、`.design/06` §3.1 与 §9：TaskProjection 是派生事实，重跑必须创建新的 ActionExecution 和 Workflow，旧执行结果不明时不得分配第二条业务 Workflow。

## 动手前四项核对

1. 权威与状态：现有 `WorkflowRef.projection_state=TERMINAL` 是最后一次 `ProjectTaskState` Activity 已写回的证据，不是 Temporal execution 已关闭的证据。Worker 在终态写回后才返回，所以这段间隙存在。修复限于已经登记的内部重跑接缝，未新增能力或上游适配。
2. 影响面：GitNexus 对 `rerun_task` 的上游风险为 `UNKNOWN`、解析出的调用者为零；文本核对 `service_api.rs` 的 `/service/v1/tasks/rerun` 路由、`scope_lifecycle.rs` 的重跑集成测试以及 `TaskProjection` 的唯一写入路径。改动读取既有 `task_projection.run_id`，不加字段、不迁移库、不改四语言契约；缺 run ID 时拒绝重跑。Web/Desktop/Mobile 均无用户重跑入口，本次无三端投影变更。
3. 副作用：版本推进和新 WorkflowRef 预写仍在原事务内；只有 Temporal `Describe` 明确返回旧执行已关闭，且 run ID、终态与投影逐值相等，才进入该事务。Open 返回冲突；NotFound、调用失败、未知状态、缺失或不一致的 run ID/终态均返回 503，不预写、不重放业务副作用。
4. 边界：同一 ActionExecution 的幂等重发沿既有 WorkflowRef 收敛；另一张准入仍受实体版本乐观锁约束。暂停或撤权仍由原启动核心的准入检查负责。Temporal 已关闭的事实不会重新变成 Open；在查询后到事务提交前没有对旧执行的“重开”窗口。结果不明属于 `apps/06` §4 的 `UNKNOWN`，仍在运行属于 `CONFLICT`；内部 HTTP 状态尚未构成面向用户的稳定 reason code。

## 实际验证

- `cargo sqlx prepare --workspace` 在受限 cgroup 中完成，新查询的离线元数据已更新。
- 受限 cgroup 中专项 `cargo test ... rerun_requires_matching_temporal_close_not_just_terminal_projection` 通过；覆盖 Open、已关闭且一致、终态不符、run ID 不符/缺失/为空、未知 Temporal 状态。
- 破坏验证：临时把 `ObservedState::Open` 改成允许重跑，专项测试退出码 101，报 `left: Ok(())`、`right: Err(409)`；已恢复并由全量测试重验。
- `systemd-run --user --scope -p MemoryMax=16G -p CPUQuota=500% -- ./tools/check.sh --full` 退出码 0，十组门禁通过；因未提供隔离 `DATABASE_URL`，实际数据库迁移演练明确 `SKIP`。

本次未重建本地 Core 镜像，也未对运行中的 Temporal Server 做端到端重跑演练；不能把单元与静态门禁记作生产验收。另经源码复核，现有 `workflow_reconcile` 只扫描非 `TERMINAL` WorkflowRef；终态投影若已缺失或写错 run ID，不会被它自动修复，需单独闭合该收敛路径，不能写作“等待现有对账即可恢复”。用户可见 `task.rerun` 入口及其稳定 reason code 属于 Stage 2 剩余交付。

后续收口见 [Task 终态投影的有界修复](task-terminal-repair.md)：周期对账已覆盖缺失或不完整的终态投影，非空错误 run ID 由受权内部重跑查证并修复；本段保留为当时提交的验证边界。

## 原 ActionExecution 目标绑定（2026-09-25 增量）

1. 权威：`.design/03` §4 与 DD-84 固定任务控制动作以原 ActionExecution 为 target，不把实体 ID 或 TaskProjection 当授权对象。本次仅收紧已有 service 内部重跑，不登记用户可达的控制 ActionDefinition。
2. 影响：GitNexus `kailo-plus` 索引处于 `716de9b`；`rerun_task`、`RerunRequest` 与测试辅助函数的上游风险均为 `UNKNOWN`，已用文本检索核对唯一 service route、集成测试、RB-01 与演练脚本。请求体仍是内部 `workflowId + actionExecutionId`，数据库字段和四语言契约未变；Web/Desktop/Mobile 的任务按钮均未开放。`allowed_action` 本身未改，server-key 两条既有调用链不受影响。
3. 副作用：Core 从固定 WorkflowRef 联出原动作，逐值核对原 target 与 Workflow ID 实体、Tenant；新准入的 target 必须是原动作 ID，Workspace 必须与原动作相同。拒绝发生在版本推进、WorkflowRef 预写和审计之前；成功后审计 target 也是原动作 ID。Temporal 关闭事实、投影一致性与实体版本 CAS 沿用既有收敛链。
4. 边界：错误 action key、错误原动作 target、错误 Workspace 或已撤销准入均为 `DENIED`/`CONFLICT` 且不启动；Temporal 结果不明仍为 `UNKNOWN`，同一控制动作重发只收敛到同一个新 Workflow；另一个控制动作撞到实体版本 CAS 后拒绝。原动作的运行终态仍由 Temporal 与 TaskProjection 共同证明，不因 service HTTP `200` 改写旧 history。

受限 cgroup 中 `cargo test -p kailo-core` 退出码 0；重建 Core 镜像 `sha256:319067f8f7a0a106ce068e6994fccae01e0a296322b388dd0ace75d256790444` 后，真实 Core/Temporal/Worker/数据库的 `stranded_workspace_is_rerun_with_new_version` 通过。用例覆盖错误原动作、错误 Workspace、原动作 target 与 Workflow ID 不一致、已撤销准入、终态投影修复、同键重发和第二张准入冲突。故意把错误 Workspace 的断言改成期待 `200`，专项测试退出码 `101`，实际返回 `403`；还原后专项再次通过。`core/verify/drill-task-rerun.sh` 退出码 0：旧 Workflow `TERMINAL FAILED`、新 Workflow `TERMINAL COMPLETED`、审计一条、搁浅计数从 1 回到 0。`check-docs.sh` 与 `check.sh --full` 均退出码 0；全量门禁的实际迁移演练因未注入 `DATABASE_URL` 为 `SKIP`。

这不是 Stage 2 任务控制交付：内部 service 仍使用通用 `task.rerun` 及运维准入，用户专属 ActionDefinition、BFF fresh Check/审批/派发、Temporal cancel RPC、共享任务详情控制与真实用户端到端仍未闭合；不能据此展示控制按钮。
