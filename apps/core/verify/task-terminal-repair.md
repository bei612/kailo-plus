# Task 终态投影的有界修复

2026-09-25。关联 `.design/06` §3.1、§9、`DD-48` 与 `V-SCN-38`。本项只修复 Core 已登记 Workflow 的派生 TaskProjection；不开放任务取消或重跑的用户入口。

## 变更前的四项核对

1. 权威与状态：Temporal execution 是最终执行状态的权威，TaskProjection 由 Worker 写回或 Core 按固定 Workflow ID 对账；`task_projection::apply` 仍是唯一写入路径。`WorkflowRef=TERMINAL` 但 TaskProjection 缺失、仍为 RUNNING 或缺 run ID，不足以让工作台显示确定结果。
2. 影响面：GitNexus 对 `workflow_reconcile::pass` 和 `patch_terminal` 报 LOW，调用链到 `spawn`、`main`；`task_rerun::rerun_task` 报 UNKNOWN，文本核对了 `/service/v1/tasks/rerun` 路由和 `scope_lifecycle` 集成调用。改动只涉及 Core 查询、既有重跑接缝、一个可回退的数据库索引及两条集成场景；不加实体字段或四语言契约，Web/Desktop/Mobile 没有新按钮。旧 Core 可读新增索引，回退脚本只删除它。
3. 外部副作用：周期对账只向 Temporal Describe，不发 Start/Cancel；健康终态只轮转 `last_observed_at`，不在 history 过期后误改为 UNKNOWN。缺口只有在 Describe 明确返回 Closed 且非空 run ID 时，经 `task_projection::apply` 补写。重跑请求发现投影与 Temporal Closed 不一致时只修复并返回 503，不推进实体版本、不分配新 Workflow；同一 ActionExecution 再次调用仍重查准入和终态。
4. 边界：NotFound 超出 retention 且投影不完整时，WorkflowRef 转 UNKNOWN，不伪造终态；NotFound 仍在 retention 内只记录观察。Temporal Open、未知状态、查询失败、事件序号溢出、数据库失败及并发写入冲突均不宣称修复。旧 WorkflowRef 的 `run_id` 可为首个 run，不能与最新 TaskProjection `run_id` 直接相等比较。非空但错误的终态 run ID 只有受权内部重跑请求触发 Describe 时才修复；周期轮转不查询健康形态的历史终态。任务取消／重跑用户入口仍未登记 Governed Action 与 BFF 控制面，不能从本项推导为可用。

## 有界查询与数据库

非终态分支沿用 `workflow_ref_nonterminal` 部分索引。终态分支按 `coalesce(last_observed_at, created_at)` 有界取候选，使用新增 `workflow_ref_terminal_observation` 部分索引；外层再以 `WORKFLOW_RECONCILE_BATCH` 限制每轮总量。完整终态只更新轮转时间，缺口才 Describe。强制关闭顺序扫描的 `EXPLAIN` 对终态分支显示 `Index Scan using workflow_ref_terminal_observation`；它证明索引可用于该谓词，不代表给出了生产数据量下的耗时基准。

## 实际验证

- 变更前的旧 Core 上，新增重跑修复场景按预期失败：请求返回 409，而断言要求首次只修复并返回 503。随后重建 Core，未以旧进程结果冒充通过。
- `cargo sqlx prepare --workspace` 与后续 `cargo sqlx prepare --check --workspace` 均退出码 0，离线查询元数据已同步。受限 cgroup 中 `cargo test -p kailo-core` 退出码 0，7 个单元测试通过；未注入集成环境的同次命令不能算真实链路验证。
- 专用 BuildKit 限制 24 GiB、10 CPU，外层 `MemoryMax=16G`、`CPUQuota=500%`；`start-core.sh` 重建并启动本地 Core，镜像 manifest 为 `sha256:6a4661a8102bf3da76af0690e362f18c683a2c8ead095d3113f4a2a3032af4bd`。
- 真实 Core/Temporal/Worker/数据库上：`workflow_reconcile` 专项 1/1 通过，覆盖终态缺投影、超 retention 缺口 UNKNOWN、完整终态只轮转；`scope_lifecycle::stranded_workspace_is_rerun_with_new_version` 专项 1/1 通过，确认首次修复后没有第二条 Workflow，同键再调用才推进。
- 本地数据库索引迁移已应用。独立临时数据库 `kailo_verify_terminal_index_20260925` 的全量 `sqlx migrate run`、最新迁移 `revert`、再次 `run` 均退出码 0；验证后已删除该临时数据库，没有删除业务库或卷。
- `./tools/check.sh --full` 在受限 cgroup 内退出码 0，十组门禁通过；其数据库实演因未向该门禁注入 `DATABASE_URL` 明确 SKIP，隔离实演见上一条。
- `./tools/check-docs.sh` 退出码 0：187 个设计引用闭合、实体 83、DD 83、SS 24、67 个场景完成映射或明确排除、Markdown lint 0 issues。
- `core/verify/run-integration.sh` 在受限 cgroup 中退出码 0：Core/Worker 的非演练集成套件通过，包含新增两条真实链路；明确 ignored 的 Relay 故障演练和审批 continue-as-new 演练未运行。
- GitNexus `detect_changes --scope all` 返回 HIGH、7 条受影响流程，均从 `workflow_reconcile::spawn` 进入 `pass`，再到 Temporal Describe、`patch_terminal`、唯一 `task_projection::apply` 或其已有 OIDC 刷新链。逐项读取 `pass`、`patch_terminal` 与 `rerun_task` 的 context 和相应执行轨迹；查询分支与唯一写入路径由上述真实拓扑套件覆盖。当前索引仍基于改动前的提交，未把 `rerun_task` 新增的 `patch_terminal` 调用边显示为图边；已按源码和集成场景单独核对，不把图的空调用集当作安全证明。

## 尚未闭合的范围

已写入非空但错误 run ID 的终态投影不会由周期轮转自动发现；受权内部重跑会查 Temporal 并修复。`observation_gap=true` 仍按既有合同向任务页显示 `PROJECTION_DELAYED`，本项没有把缺口伪装成无缺口。任务取消／重跑的 Governed Action、BFF 用户入口和三端交互仍须独立交付。
