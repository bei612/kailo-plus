# Task 终态投影缺口的呈现核验

2026-09-25。关联 `.design/06` §3.1、§9、`DD-48` 与 `V-SCN-38`：TaskProjection 是派生事实，WorkflowRef 标为 `TERMINAL` 而 TaskProjection 缺失或仍为 `RUNNING` 时，任务列表和详情返回 `observation=PROJECTION_DELAYED`，不把该行渲染为确定完成。

## 变更前的四项核对

1. 权威：Temporal execution 才能证明最终结果；TaskProjection 只由 Worker 写回或 Core 对账产生。此变更不新增 Action、Workflow 或第二份状态权威。
2. 影响面：GitNexus `impact` 对 `governance_api.rs::observation` 返回 `LOW`、三处受影响符号，直接消费者是 `task_view`，再到任务列表和详情。只改 BFF 既有 `TaskView.observation` 的值，不改 schema、持久化、旧数据或三端的解析格式；Web/Desktop 共用既有任务视图，Mobile 仍只读。
3. 副作用：缺投影不再被当作无观测问题；已有 `UNKNOWN` dispatch/ref 与 `observation_gap=true` 的优先级不变；不会向 Temporal 发控制命令，也不会改变重跑准入。终态状态值采用既有封闭枚举，不接受未知状态为成功。
4. 边界：空投影和仍 `RUNNING` 进入六类中的 `UNKNOWN/PROJECTION_DELAYED`；已写 `COMPLETED` 等终态保持原样。并发写回后的下一次读取重新计算，重复读取不产生副作用；超时、撤权、租户暂停、额度变化均不经此只读判断处理。有效但错误的 run ID 仍由重跑时的 Temporal Describe 拒绝，自动修复尚未闭合。

## 实际验证

- `cargo test -p kailo-core --bin kailo-core terminal_ref_requires_terminal_task_projection`：1 passed。
- 故意把条件中的 `TERMINAL` 改成不可能匹配的值，同一测试按预期失败：`left: None`、`right: Some(ProjectionDelayed)`；随后还原源码。
- `systemd-run --user --scope -p MemoryMax=16G -p CPUQuota=500% -- ./tools/check.sh --full`：退出码 0；Rust/Go/TypeScript/Dart 检查与测试、契约、replay、追溯、供应链、seam、安全与文档步骤均通过。真实迁移回退演练因没有隔离 `DATABASE_URL` 明确 SKIP。
- 提交前 `gitnexus detect-changes --scope all` 报 `HIGH`、7 条 execution flow：除任务列表/详情外还把同文件后续的 `ApprovalRow.target_id` 等位置移动识别为改变。逐行 `git diff` 核对，实际业务表达式只改 `observation`，未改审批字段、查询或生命周期投影；全量门禁通过。该图风险不当作自动放行，保留本次专项测试与 diff 供复核。

本项仅闭合“终态 TaskProjection 缺失/非终态时的 UI 观测分类”，不宣称终态投影的周期自动修复、用户取消/重试入口或生产验收已完成。

后续周期修复的边界和实际验证见 [Task 终态投影的有界修复](task-terminal-repair.md)；本记录的完成声明仍仅限于 UI 观测分类。
