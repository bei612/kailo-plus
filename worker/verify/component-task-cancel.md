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

## 已实现删除分支的隔离候选验证（2026-10-02 UTC）

前文五个 kind 与宿主检查只记录当时事实，不作为本次范围或执行方式。基线 `e4c544fdb63d5e54fe775d58e684249166c89543` 的 Data 候选 `/volumes/data/kailo/tmp/codex-delete-commit-candidate-20261002.KBSv5P` 已接入现有 `TENANT_LIFECYCLE/DELETE` 分支：同一冻结 `snapshotId` 经既有 `CoreAPI.AdvanceTenantDelete` Activity 交给 Core 的持久子流程；Worker 校验返回的 snapshot/subprocess 引用，不建立另一份删除或 ExternalExecution 权威。

取消以 `CancelPending` 继续查询同一 Core 子流程，由已持久化的不可逆标记裁决；Activity 超时、provider 失联或矛盾响应不能直接产生业务 `FAILED/CANCELED`，仍等待原生终态证据。以上是源码消费事实，不是本轮真实 Server/provider 验收，公开删除 workflow gate 未开放（`DD-99/100/109`、`V-SCN-31`）。

首次窄验证报 `component_task.go:275:39: undefined: generated.Failed`，实际退出 1，原件为 `/volumes/data/kailo/tmp/codex-delete-candidate-worker-20261002.faLez0/{go-verify,exit}.log`。共享 ResourceState 引入同名 `FAILED` 后，原 Go 生成器将 TaskStatus 常量命名为 `TaskStatusFAILED`；唯一生产引用与两个既有 suspension 检查各两处断言已机械同步，线格式仍为 `"FAILED"`，没有新测试、重放 history 或夹具。

该轮仅在不可变检查镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82` 执行：

```bash
gofmt -l activities/core_api.go workflows/component_task.go workflows/tenant_suspension_test.go workflows/workspace_suspension_test.go internal/contracts/generated/contracts.go
go vet ./activities ./workflows ./replay-tests
go test ./workflows ./replay-tests
```

格式检查无输出；workflows 与 replay-tests 均 `ok`，attach 与容器终态退出 0。日志为 `/volumes/data/kailo/tmp/codex-delete-candidate-worker-final-20261002.n9kk40/{preflight,limits,go-verify,exit}.log`，SDK UID/GID 1000、实际 4 CPU/6 GiB、无额外 swap，依赖缓存来自 `/volumes/data/kailo/check-cache`。未使用宿主 Go，也未新增检查。

该结果对应 Session 字段闭合后的生成物，先于 Customer 消费所需 `BindingNotActive/RateLimited` 两项 reason code 纳入；其后重新生成的 Go 文件不能借用这次退出码声称已经再验证。后续实际合并输入由批末既有门禁分别核验。

两项 reason code 闭合后的原 `tools/gen.sh` 与 `--check` 已实际退出 0，四侧与 Mobile catalog 同步，日志在 `/volumes/data/kailo/tmp/codex-delete-candidate-reasons-gen-20261002.1ReYtS/`；这一次没有运行 Go vet/workflows/replay，不当作第二次 Worker 通过。

本轮没有新 DELETE 录制历史，没有实际原生 CAS 保留统计、四类 provider 合流、不可逆窗口取消或结果不明的业务验收；现有 replay 通过不证明这些新增路径。候选尚未提交、push、构建或部署，不把上述窄验证记为 Stage 3 完成。四侧最终生成与 Core 的真实失败另见 [Tenant 删除记录](../../core/verify/tenant-deletion.md)。

## TaskStatus 生成常量消费者收口（2026-10-11 UTC）

本节保留上述历史证据，只记录独立的 Worker 编译修复。基线为
`a94d0ed35a843003f83ae4e977527ee2f806e3d4`，精确源码候选树为
`f92cbdb48782d378994ae40c401e69d1979cab28`；本节是验证后追加，未包含在该源码树中。

1. 权威为 `.design/06` 的 TaskProjection 与取消收尾合同，以及
   `contracts/enums/task_status.schema.json` 的既有 `CANCELED`。
   `c442f2bb6e5c9e4db624057fe756272574a807f2` 的生成变更将 Go 符号
   `Canceled` 消歧为 `TaskStatusCANCELED`，但消费者未同步。基线生成文件
   `worker/internal/contracts/generated/contracts.go::TaskStatusCANCELED`
   已有该常量；本批不修改 Schema 或生成代码。
2. 全 Worker 源码检索得到 17 个 Go 文件的 24 处旧引用，涉及五个 Activity
   消费者、Agent/组件/绑定/协议会话 Workflow、Tenant 删除取消投影及既有检查。
   精确候选仅替换这 24 处常量名；`component_release_test.go` 的未提交
   reconcile 类型变化未混入。没有新增 API、字段、别名、迁移或执行入口。
3. 线格式仍为 `CANCELED`，分支、Activity 调度、投影时序、取消重试和
   continue-as-new 未变，不增加 Temporal version 分支或第二份状态权威。
   取消请求不是终态证据；未知响应、超时及撤权后的收敛沿原逻辑，仍不可把
   UNKNOWN 当作成功或失败。
4. 空输入、重复投递、并发取消、部分完成及恢复后重入没有新的行为或兼容格式。
   该变更不涉及 secret、quota 或租户存储；六类错误的原分类不变。
   既有 Workflow 与 replay 检查复核原路径，不据此声称完整故障演练或业务验收。

验证复用固定 SDK 镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
Go `1.25.14`；执行 UID/GID `1000:1000`，实际 cgroup 为
`cpu.max=400000 100000`、`memory.max=8589934592`、`memory.swap.max=0`。
候选与基线由各自 Git 树导出，构建缓存及临时目录均位于
`/volumes/data/kailo/tmp/worker-canceled-compile.srdpyp`；已有 Go 模块缓存只读挂载，
不与原全量检查并行写入共享缓存。未调用宿主 Go，结束时已停止验证容器。

基线执行 `go test ./activities -run '^$'` 实际退出 `1`：

```text
activities/agent_installation.go:33:105: undefined: generated.Canceled
activities/agent_task.go:107:105: undefined: generated.Canceled
activities/application_binding.go:23:77: undefined: generated.Canceled
activities/component_action.go:21:77: undefined: generated.Canceled
activities/protocol_session.go:67:48: undefined: generated.Canceled
FAIL apps/worker/activities [build failed]
```

精确候选随后串行执行：

- 对 17 个变更文件执行 `gofmt -l`：输出为空；`git diff --check` 退出 `0`。
- `go vet ./...`：退出 `0`。
- `go test ./... -run '^$'`：退出 `0`，只证明全包编译，不冒充测试执行。
- `go test ./activities ./workflows ./replay-tests -count=1`：退出 `0`，三个包均 `ok`。
- 固定基线就是本轮反例，旧符号真实导致失败；候选恢复对同一生成权威的消费后通过。
  没有新增测试或修改既有断言语义。

原始输出分别为上述 Data 目录的 `baseline-compile.log`、`candidate-format.log`、
`candidate-vet.log`、`candidate-compile.log` 与 `candidate-tests.log`。
本轮没有运行 contracts 的业务往返检查；其 Agent Session/Invocation 时间格式问题
不属于本次常量修复，见 [Agent Session 查询](../../core/verify/agent-session-query.md)。
没有重跑全量检查、修改正式工作树的其他脏改动、构建发布镜像或部署 Worker；
窄检查通过不等于全局门禁通过、Cells 治理接入完成或生产就绪。
