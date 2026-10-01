# 任务视图未知状态拒绝

2026-09-25。依据 `.design/03` §6 的 TaskProjection 派生权威、`.design/06` §9 的受权任务视图、`apps/06` §4 的 `UNKNOWN` 失败分类。此项只修复 BFF 的任务读取，不开放取消或重跑入口。

## 变更前核对

1. 权威：任务运行状态来自 Temporal/Worker 与 ExternalExecution，Core 的 TaskProjection 只读。BFF 不得把数据库中存在但不属于四语言契约的状态值解释成“没有状态”。
2. 影响面：GitNexus 对 `governance_api::task_view` 报 `LOW`，直接调用者为 `get_task` 与 `list_tasks`，涉及两条本人任务读取路径；不改数据库、契约字段、Temporal、上游源码或三端控制入口。
3. 副作用：原实现对可选 `reason_code`、`approval_status`、`workflow_kind`、`task_status` 使用 `and_then(parse)`，未知非空值静默变为 `None`。现在只允许数据库 `NULL` 映射为 `None`；未知非空值返回带 operation ID 的 `UNKNOWN/DEPENDENCY_UNAVAILABLE` 错误体，不返回可误读的 TaskView。
4. 边界：同一列表有一条未知状态时整页拒绝；详情同样拒绝。已知枚举和真正的 `NULL` 沿用原映射，投影新鲜度及终态对账规则不变。错误不触发 Start、Cancel 或重跑，也不改变任何事实。

## 实际验证

- 受限 cgroup 中的定向测试 `cargo test --manifest-path core/Cargo.toml -p kailo-core unknown_persisted_task_enums_do_not_become_absent_fields` 通过，四个非空未知枚举都被拒绝。
- 破坏验证：仅把 `task_status` 临时恢复旧 `and_then(parse)` 后，同一测试退出码 `101`，断言发现原实现返回 `Ok(TaskView { task_status: None, ... })`；随后恢复修正。
- 恢复后的 `./tools/check.sh --full` 在 `MemoryMax=16G`、`CPUQuota=500%` cgroup 中退出码 `0`，十组门禁通过。数据库迁移实演因该命令未提供 `DATABASE_URL` 而 `SKIP`；本次没有数据库迁移。
- 提交前 GitNexus `detect-changes --scope all` 报 `CRITICAL`、17 条流程，并把 `ApprovalRow/decisions` 等列为改动符号。已逐块核对 `git diff --check` 与实际 diff：生产代码只改 `task_view` 的错误回应及四个可选枚举解析，另增一个同文件单测；审批结构、查询及决定逻辑均无文本改动。图的原始索引把 `task_view` 定在旧文件 172–198 行，新增代码使后续符号行号移动，因此不能把 `CRITICAL` 直接降成“无影响”；对图给出的真实调用者 `get_task/list_tasks` 已核对共用 `task_view`，全量门禁及破坏测试覆盖这条读链。

任务取消与重跑仍需独立完成 Governed Action、BFF 控制入口、Web/Desktop 操作和 Temporal 真终态验证；此项不将其计为已完成。
