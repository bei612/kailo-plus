# ComponentTaskWorkflow 取消收尾核验

2026-09-25。范围只含已激活的五个 `ComponentTaskWorkflow` kind 的 Worker 收尾；本记录不声称 BFF 用户控制入口已开放。权威为 `.design/06` §2、§3.1、§9，交付归属为 `apps/02` §4。

## 动手前四项核对

1. 取消的语义是 Temporal `RequestCancelWorkflowExecution` 后观察 `ctx.Done()`，以 `NewDisconnectedContext` 完成终态投影，再返回 `CanceledError`。现有业务 Activity 均为幂等收敛；已投递的 SpiceDB、Buzz 或 Core 副作用不会因取消自动回滚。当前五个 kind 没有 `ExternalExecution` 或 `CapacityLease` 可释放，因此业务实体保持原收敛中状态，不能因 Workflow 取消宣称实体已完成。
2. GitNexus 对 `converge`、`task.fail`、`projector` 的上游影响均报 `HIGH`，共涉及成员建立/撤权、Tenant/Workspace 建立及设备公钥投影；`ComponentTask` 的入边为 `UNKNOWN`，文本核对 `worker/main.go` 与 `replay-tests/baseline_test.go` 的注册。`detect_changes` 报 10 个已变更符号、10 条受影响流程，风险 `high`。
3. 取消请求与最后一次 Activity 并发时，不把请求接受视作外部副作用已停止；只有新的 `CANCELED` 投影写回才暴露 Workflow 终态。Core 不可达时脱离已取消的 Context 按轮重试，history 接近上限时 continue-as-new 只续跑取消收尾，不重复业务步骤。
4. 无效 input 仍确定拒绝；依赖暂不可用属于 UNKNOWN 并等待收敛；重复取消由 Temporal 原生终态约束，不重放业务动作；在途撤权仍留在 `REVOKING`，由已有搁浅实体对账与新的受治理 `task.rerun` 修复。BFF 路由与按钮未开放，未闭合准入前不产生用户控制入口。

## 实际验证

- `systemd-run --user --scope -p MemoryMax=8G -p CPUQuota=400% go test ./workflows -run '^TestComponentTaskCancel' -count=1`：`ok`。覆盖正常取消、Core 首次拒收取消投影后的重试、continue-as-new 输入只写终态而不重执行业务步骤。
- `systemd-run --user --scope -p MemoryMax=8G -p CPUQuota=400% go test ./... -count=1`：全部 Go 包通过，`replay-tests` 通过。
- 破坏验证：把取消投影临时改为 `FAILED` 后，同一专项测试退出码 `1`，报 `[RUNNING RUNNING RUNNING FAILED]` 而非 `CANCELED`；已恢复源码并重跑专项测试通过。
- `systemd-run --user --scope -p MemoryMax=20G -p CPUQuota=600% ./tools/check.sh --full`：退出码 `0`，10 组全部通过；数据库实迁因未提供隔离 `DATABASE_URL` 显式 `SKIP`。

尚未声称真实 Server 的取消端到端已验证，也未声称 `task.cancel` 与 `task.rerun` 已作为用户 Governed Action 接入。这些仍属 Stage 2 §4 的未闭合部分。

## ExternalExecution 当前适用性复核（2026-09-26）

权威边界：`.design/01` §3 将 ExternalExecution 定义为 Workflow 关联的**组件 native task/job** 引用；`.design/03` §6 要求它固定真实 ComponentBinding kind/id、version、release 与 generation；`.design/06` §6 和 `DD-48` 要求适用的真实 native 副作用在 dispatch 前建记录，结果不明只按登记的 query/dedupe seam 对账；`.design/07` §5 把该记录放在 Application Adapter 的执行链。没有 binding 与 native execution 时，不能用虚构的 binding ref 建一张空表冒充接入完成。

本次只读核对当前本地 Core 数据库：`catalog.action_definition` 有 21 条 ACTIVE，按 `component_type_key / execution_mode / obs_progress_source / obs_terminal_source` 分组分别为 `buzz / TEMPORAL / TEMPORAL / TEMPORAL = 2`、`core / PROTOCOL / NONE / NATIVE = 8`、`core / SYNC / NONE / SYNC_RESULT = 6`、`core / TEMPORAL / TEMPORAL / TEMPORAL = 5`。`to_regclass` 对 `catalog.application_binding`、`catalog.platform_provider_binding`、`projection.external_execution` 均返回空。Worker `ComponentTask` 只注册成员建立/撤权、Tenant/Workspace 建立与 Buzz 身份五种 kind；实际步骤是 SpiceDB 关系收敛、Core/Buzz 平台投影及 Core 状态跃迁，没有接入 Cells、WeKnora、Wren 或 CocoIndex 的 native task/job，也没有 Application Adapter dispatch。

这不免除平台投影副作用的写前事实与结果不明纪律：`membership_lifecycle.rs::launch_membership/launch_scope` 先核对已准入的 ActionExecution，`component_task.rs::start_typed/prewrite` 在 Temporal Start 前落唯一 WorkflowRef；`client_keys.rs::register` 在启动身份投影前持久化 ActionExecution。SpiceDB `Converge/RevokeSubject` 采用幂等写入后 FullyConsistent 读回，Buzz 投影由 Core 端点核对 binding/version 与 native 结果。取消不会自动撤回已发生的外部写入。上述证据只证明当前没有需要实例化 ExternalExecution 的组件 native execution，不证明所有平台 RPC 的失败分支都已通过生产故障演练。

因此 Stage 2 的 ExternalExecution 实例化门禁当前为**无适用对象**，不是“功能已实现”；首个真实 native task/job 的 ComponentBinding 与 ActionDefinition 一旦接入，必须与写前记录、幂等、UNKNOWN、native query/dedupe、TaskProjection 同刀交付，缺一项就不得 active。这个边界不放宽 `.design/06` §6 的真实副作用合同。
