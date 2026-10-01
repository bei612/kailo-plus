# Task 终态投影的有界修复

2026-09-25 首次交付，2026-09-26 补齐完整终态投影的周期核查。关联 `.design/06` §3.1、§9、`DD-48` 与 `V-SCN-38`。本项只修复 Core 已登记 Workflow 的派生 TaskProjection；任务控制入口由独立的 Governed Action 链交付。

## 变更前的四项核对

1. 权威与状态：Temporal execution 是最终执行状态的权威，TaskProjection 由 Worker 写回或 Core 按固定 Workflow ID 对账；`task_projection::apply` 仍是唯一写入路径。`WorkflowRef=TERMINAL` 但 TaskProjection 缺失、仍为 RUNNING 或缺 run ID，不足以让工作台显示确定结果。
2. 影响面：GitNexus 对 `workflow_reconcile::pass` 和 `patch_terminal` 报 LOW，调用链到 `spawn`、`main`；`task_rerun::rerun_task` 报 UNKNOWN，文本核对了 `/service/v1/tasks/rerun` 路由和 `scope_lifecycle` 集成调用。首次交付涉及 Core 查询、既有重跑接缝与一个可回退的数据库索引；本次补齐完整终态校验只改 Core 对账与真实集成用例。不加实体字段或四语言契约，Web/Desktop/Mobile 不因本项新增按钮。旧 Core 可读该索引，回退脚本只删除它。
3. 外部副作用：周期对账只向 Temporal Describe，不发 Start/Cancel；完整终态投影在可核查窗口内也按固定 ID 重查，缺失或状态、run ID 不一致时，仅在 Describe 明确返回 Closed 且非空 run ID 后经 `task_projection::apply` 修复。重跑请求发现投影与 Temporal Closed 不一致时只修复并返回 503，不推进实体版本、不分配新 Workflow；同一 ActionExecution 再次调用仍重查准入和终态。
4. 边界：NotFound 超出 retention 且投影不完整时，WorkflowRef 转 UNKNOWN；完整历史终态不因最近一次投影写入时间就被 NotFound 推翻。预写引用仍在 retention 窗口内而终态投影声称已完成时，NotFound 才作为矛盾事实使引用进入 UNKNOWN。Temporal Open、未知状态、查询失败、事件序号溢出、数据库失败及并发写入冲突均不宣称修复。旧 WorkflowRef 的 `run_id` 可为首个 run，不能与最新 TaskProjection `run_id` 直接相等比较；核对对象是 TaskProjection 的最新 run ID。

## 有界查询与数据库

非终态分支沿用 `workflow_ref_nonterminal` 部分索引。终态分支按 `coalesce(last_observed_at, created_at)` 有界取候选，使用新增 `workflow_ref_terminal_observation` 部分索引；外层再以 `WORKFLOW_RECONCILE_BATCH` 限制每轮总量。完整终态投影的 `updated_at` 尚在 retention 长度内时重查固定 Workflow ID；更老的完整投影只轮转游标。`updated_at` 不是执行关闭时间，故预写引用已超出 retention 时的 NotFound 不得降级完整终态。强制关闭顺序扫描的 `EXPLAIN` 对终态分支显示 `Index Scan using workflow_ref_terminal_observation`；它证明索引可用于该谓词，不代表给出了生产数据量下的耗时基准。

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

## 2026-09-26 增量验证

2026-09-26 增量：新 Core 镜像 `sha256:7bfb1c9dfc2ad10fbd9c4854294cba95a567baaf7ba7e34a30f188d4bf869cc8` 上，真实 Core/Temporal/Worker/数据库专项 1/1 通过，核对八条 WorkflowRef：非空错误 run ID 被修复并留下 `observation_gap`，历史引用虽有近期投影写入但 Temporal NotFound 时仍保留终态。故意把历史终态断言改成 `UNKNOWN` 后专项按预期失败（实际 `TERMINAL`，退出码 101），恢复断言后复跑 1/1 通过。`cargo sqlx prepare --workspace` 与 `cargo fmt --all -- --check` 通过。

同版 `./tools/check.sh --full` 十组通过；其中实际数据库迁移前进／回退因未给隔离 `DATABASE_URL` 明确跳过，配对回退脚本检查通过。受限 cgroup 的 `core/verify/run-integration.sh` 首轮在旧有 `scope_lifecycle` 夹具中失败：夹具把已派发且 `dispatch_state=UNKNOWN` 的动作直接改为 `gate_state=REVOKED`，违反从初始迁移起存在的 `dispatch_requires_allowed` 约束。修正夹具后，未派发的独立控制动作撤权得到 `FORBIDDEN`，已派发动作仍验证同键幂等；定向 1/1 通过。完整真实集成套件第二轮退出码 0，覆盖 Core、Worker、OpenBao、Buzz、SpiceDB 与 Temporal；明确标记为 ignored 的故障演练没有冒充已运行。

2026-09-26 后续补验：在本地 PostgreSQL 新建 `kailo_verify_gate_20260926_01` 隔离库，先确认库名不存在且不等于业务库 `kailo_core`；对隔离库应用全部 20 个迁移后，把仅指向该库的 `DATABASE_URL` 传入 `./tools/check.sh --full`。整套门禁退出码 0；第 4 组实际执行前进、回退、再前进并通过，33 个命名约束与 `contracts/enums/` 逐值相等。命令在 `MemoryMax=16G`、`CPUQuota=500%` 的 cgroup 内执行，结束陷阱删除该隔离库；事后查询确认临时库数量为 0，业务库 `kailo_core` 仍可连接。此次只证明当前迁移序列在空白隔离库上的全量前进和最新一步的回退、再前进，不把它当作已在生产数据或所有历史版本上演练回退。

## 尚未闭合的范围

Temporal history 已过保留期的完整投影不能再从上游反向验真，仍以 Core 保存的派生事实保留，不把无法获得的历史伪装为新观察。`observation_gap=true` 继续使任务页显示 `PROJECTION_DELAYED`。周期核查的吞吐上界由 `WORKFLOW_RECONCILE_BATCH` 与轮转间隔限制，生产规模下的积压与时延尚无容量实测；本项不宣称整个 Stage 2 退出门禁完成。
