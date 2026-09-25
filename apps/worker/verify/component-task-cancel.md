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
