# Workflow 终态兜底投影的跨 run 事件顺序

2026-09-25。依据 `.design/06` §3.1 与 DD-48：Core 的 TaskProjection 按 `event_id` 单调采纳，Temporal 是 Workflow 状态权威；结果不明不得伪造完成。

## 动手前四项核对

1. 权威与状态：Worker 的 `ComponentTaskWorkflow` 在 continue-as-new 时把先前 run 的 history 长度带入 `EventBase`；Core `TemporalClient::describe` 只返回最新 run 的 `history_length`。旧兜底路径直接把最新长度当 `event_id`，可能比 Core 已保存的跨 run 序号小，导致终态被去重拒绝。修复仍通过 `task_projection::apply` 唯一写入路径，不新建状态权威。
2. 影响面：GitNexus 对 `workflow_reconcile::patch_terminal` 的 upstream impact 为 LOW，直接调用者 `pass`，继续到 `spawn` 和 `main`；源代码核对了 `task_projection::apply`、Worker `eventID` 与 `ComponentTaskWorkflow` 的 continue-as-new。只改 Core 兜底投影和既有集成用例；无 schema、四语言契约或三端变更。
3. 副作用：新序号取 `max(已保存序号, 最新 run history 长度) + 1`，只在 Temporal 明确观察到 Closed 时补写。并发写入抢先后回读 status/run ID；不一致就报本轮失败、交给下一轮，绝不宣称修复成功。序号溢出、缺 WorkflowRef、数据库失败同样不产生成功结论。
4. 边界：没有旧投影时从最新 history 长度之后写入；旧序号更大时从旧值之后写入。NotFound、Open、未知状态、Describe 失败仍沿原来的 UNKNOWN/不改终态路径。此改动不扩大 `workflow_reconcile` 的扫描范围：已是 `TERMINAL` 的 WorkflowRef 若缺投影或投影 run ID 错误，仍不会被周期对账自动修复。任务取消/重跑的用户 Governed Action 入口也不在本次改动范围。

## 实际验证

- 受限 cgroup 的 `cargo test -p kailo-core reconcile_event_id_stays_ahead_of_prior_runs`：1 passed，覆盖空旧值、高旧值、高最新长度和溢出。
- 破坏验证：暂时把 `max` 改成 `min`，同一专项测试退出码 101，第一项断言显示 `Some(1)` 不等于 `Some(21)`；随后恢复 `max`。
- 使用内存 24 GiB、CPU 10 核限额的专用 BuildKit 重建 Core，`start-core.sh` 退出码 0，Core 容器已重建并启动。
- 在运行中的 Core、Temporal、Worker 与数据库上执行 `cargo test -p kailo-core --test workflow_reconcile -- --nocapture`：1 passed，0 failed。用例先保存 `last_event_id=1000000` 的 RUNNING 投影，再让 Temporal 终结；断言补写 FAILED、`observation_gap=true` 且新序号大于旧值。
- 同一受限 cgroup 内执行 `sg docker -c 'bash core/verify/run-integration.sh'`：退出码 0；Core 全部非演练集成用例及 Worker 测试通过。明确标记为 ignored 的 Relay 故障演练和审批 continue-as-new 演练不由该命令执行。
- 受限 cgroup 的 `./tools/check.sh --full`：退出码 0，十组门禁通过。未提供隔离 `DATABASE_URL`，实际迁移前进/回退演练为 `SKIP`；本次没有迁移。

后续对终态缺口的有界轮转与索引见 [Task 终态投影的有界修复](task-terminal-repair.md)。本记录中的扫描范围描述只对应当时的提交。
