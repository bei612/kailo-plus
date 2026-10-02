# Worker 冻结 owner 审批判定核验

2026-10-02。本记录只描述已实施的 `worker/workflows/approval.go` 增量及本次实际证据。
记录时源码尚未提交、未构建发布产物、未部署；不据此关闭 Stage 或登记新 owner
正向业务链通过。本次没有新增测试、夹具、history、检查脚本、契约或公开入口。

## 权威、影响面与实现边界

- `REQ-03`、`DD-47`：审批属于统一治理链；Core 在启动前冻结 target、参数、policy、
  owner ID/version 与角色要求，Temporal history 承担审批生命周期权威。
  依据 [领域模型 §6](../../../.design/03-领域模型与权限模型.md) 与
  [ApprovalWorkflow §4](../../../.design/06-Temporal任务工作台.md)。
- `DD-69`：Workflow 行为变更用 `GetVersion` 门控，发布前重放已录制的 history；
  Validator 不做 fresh 权限检查，Update handler 经既有 Activity 准入后才记录决定。
  依据 [设计决策](../../../.design/02-源码证据与设计决策.md) 与上述 Workflow 合同。
- 直接适用 `V-SCN-37`（多 owner 与 Tenant admin 分别满足，不以总人数替代）；
  `V-SCN-31` 的 Tenant 删除 owner 审批及 `V-SCN-07` 的批准后撤权属于相邻业务链。
  三者均不因本次编译和旧 history 重放而记为业务场景通过，见
  [验证矩阵](../../../.design/16-设计验证矩阵.md)。
- 本刀只改 `approval` 的版本门控结果、`satisfied()` 与 `Approval()`。
  `FreshApprovalAdmission`、逐人不可变决定、有效 DENY 终结、投影、consume、invalidate、
  取消、期限与 continue-as-new 路径未被替换；没有第二套权限或审批权威。

原 `satisfied()` 对非 `NONE` owner 要求一律返回不满足，因而既有
`ALL_AFFECTED_OWNERS` 合同无法由 owner 决定满足。本次直接修正这份判定：

1. `ALL_AFFECTED_OWNERS`：冻结列表中每个 owner 都必须有已获 Core 准入的 `APPROVE`。
   同一 owner 的多份 Resource/Asset 引用由同一个决定满足，不要求重复投票。
   Core 证实的零资源清单可为空，不伪造 owner；空 owner 清单仍按角色要求判定，
   owner 与角色要求同时为空时不自动批准。`tenant.delete` 的 Tenant admin 角色票仍独立必需。
2. `TARGET_OWNER`：恰有一份与 input `target_type/target_id` 对应的冻结引用，且其 owner
   已 `APPROVE` 才满足；空、多份或错目标均不满足。该要求本身可以满足审批，
   不另造“所有动作都必须有角色票”的规则。
3. 每项 `role_requirements` 独立按不同 `approver_principal_id` 计数，满足该项
   `min_distinct`。同一 HUMAN 可同时满足 owner 和多个角色要求，但仍只有一个不可变决定；
   不用总票数或不同角色的并集替代某个要求。
4. 未知 owner 枚举不视为 `NONE`；缺少满足证据不转 `APPROVED`。
   本刀不新增错误码或改变 `06-工程基线规范.md` §4 的六类错误映射，
   fresh 拒绝与外部结果不明仍沿用既有 Activity/Workflow 路径，不把结果不明判成终态。

冻结 owner 的同 Tenant、Resource/Asset 当前版本、active HUMAN 身份与 SpiceDB owner
relationship 的双重核验，以及投票与消费前的 fresh 准入，仍属于 Core。
Worker 只计算已准入的不可变决定，不能凭持有 owner ID 授权。
`ApprovalWorkflowInput` 没有独立的目标版本字段；Worker 没有伪造一份版本作比较，
`AffectedOwnerRef.target_version` 的冻结和现状核验仍由 Core 承担。
本记录不把并行 Core 切片尚未完成的验证计入 Worker 结果。

新增 `approval-owner-requirements` change ID 仅在 input owner 要求非 `NONE` 时执行
`GetVersion(DefaultVersion, 1)`：旧非 `NONE` history 走 DefaultVersion 时保留原不满足行为，
新 run 使用修正判定。`NONE` history 不增加此 marker。原 continue-as-new 门控保留。
SDK 能力来源已在只读上游核验：`temporal-sdk-go` commit
`b7c242c6894df088a57a85b33d0586e908da8b93`，`workflow/workflow.go::GetVersion`；
没有执行 `.references` 中的内容。

## 编辑窗口与图谱证据

编辑前统一索引为 `apps-source`，源码根 `/volumes/kailo/apps`，indexed commit
`c478169a07376f3a7271ed8b857d06c307b87fa2`，indexedAt
`2026-10-02T02:45:14.251Z`，schema 4、runner current、content drift current、
`incompleteReasons=[]`。集中刷新真实终态为 0。
完整 freshness 回执在
`/volumes/data/kailo/tmp/codex-agent-definition-fresh-receipt-20261002.6ZOXK9.log`。
之后 metadata-only 提交 `6d2bb152bad7106bd99d0274162e637d2fbecf83`
只改变三份既有 manifest 的来源登记，不改变本刀冻结的 `approval.go`。

原生 LocalBackend 对三个实际符号执行了 context 和 upstream impact，完整原件为
`/volumes/data/kailo/tmp/codex-owner-worker-preimpact-20261002.zMAFN6.raw.jsonl`：

- `approval`：LOW，直接调用者 `Approval`。
- `satisfied`：LOW，直接调用者 `decide`。
- `Approval`：UNKNOWN，图中没有直接 CALLS；不是未使用。
  源码核对真实注册在 `worker/main.go`，既有 workflow tests 与
  `worker/replay-tests/baseline_test.go` 也注册该 Workflow。
  Temporal 的运行时回调不能据零 CALLS 推断为零风险。

首次文件级 PDG 的 controls 共 220、flows 共 277，返回各受 200 条上限截断；
该输出完整保留在上述原件，但不称为完整文件 PDG。
随后只对冻结源码中 `satisfied`（BasicBlock 行前缀 93）与 `Approval`（前缀 352）
执行有界查询，并分别核对总数与返回数：`satisfied` 的 CDG 19/19、
REACHING_DEF 13/13，`Approval` 的 CDG 56/56、REACHING_DEF 67/67。
完整原件为
`/volumes/data/kailo/tmp/codex-owner-worker-pdg-bounded-20261002.0Eywg0.raw.jsonl`。
这些是本刀编辑前的精确函数依赖证据，不冒充全文件或编辑后新代码的完整 PDG。
`explain` 没有持久 finding，仍不覆盖 closure/property/implicit 等动态流，不能当作安全证明。

两次 reader 真实退出码均 0；各自原件记录实际 systemd cgroup：memory.max
6442450944、memory.high 5368709120、memory.swap.max 0、cpu.max `200000 100000`。
使用核验过的 native runner，不起新 writer、不查询旧外层图谱。

`approval.go` 精确 diff 为 47 行新增、9 行删除；before 与 delta 保存为：

- `/volumes/data/kailo/tmp/codex-owner-worker-approval-before-20261002.go`，
  SHA-256 `c28c827fbdaa14708b53318eb5135f9e7ad14a9407c73f20d9f67894e34a2b36`。
- `/volumes/data/kailo/tmp/codex-owner-worker-approval-delta-20261002.patch`，
  SHA-256 `07bd092df1deb72e42ad89701451af2906ee999edf4ea76ccfce658a09613d2c`，
  与本刀最终 `git diff -- worker/workflows/approval.go` 摘要一致。
- after 源码 SHA-256
  `bd89b8427409c2c78f0e49b52a84c4ecd09891c706309da96f316b2a5e7b2a0d`。

## 实际 SDK 验证及限制

唯一一次窄验证使用不可变 SDK image
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
容器内 Go 为 `go1.25.14 linux/amd64`，不调用宿主 Go。
执行前检查了构建进程、CPU/内存压力；当时 MemAvailable 为 36112748 kB。
创建后、启动前回读实际 HostConfig：4 CPU（NanoCPUs 4000000000）、memory
6442450944、memory+swap 6442450944。
既有 `/volumes/data/kailo/check-cache` 只供 `/cache/go-build`、`/cache/go-mod` 与
`/cache/home`，临时目录也在 Data；没有降低或修改 Cargo 并行参数。

在真实 `worker` 源码上实际执行：

```bash
gofmt -w workflows/approval.go
test -z "$(gofmt -l workflows/approval.go)"
go vet ./workflows ./replay-tests
go test -count=1 ./workflows ./replay-tests
```

上述命令均成功，gofmt 未改变 after 摘要；原始 stdout 为：

```text
ok  	apps/worker/workflows	0.059s
ok  	apps/worker/replay-tests	0.056s
stream_exit=0 actual_exit=0
```

日志目录为 `/volumes/data/kailo/tmp/codex-owner-worker-verify-20261002.W3otC7`：
`go-verify.log` 保存原始 Go stdout，`exit.log` 保存实际容器退出码，
`preflight.log`、`limits.log`、`image.log` 分别保存预检、实际限额与镜像身份。
`cleanup.log` 记录只删除确切所属验证容器；其后只读 `docker ps -a` 查询该名称
退出 0、结果为空，验证容器已清理。最终定向 `git diff --check` 退出 0。

亲读并解码的 9 份既有 Approval histories 是 consumed、invalidated、cancelled、
expired、can_1_waiting、can_2_approved、can_3_consumed、20260926 与 platform。
它们的 owner 要求全部是 `NONE`、受影响 owner 引用均为空。
因此本次重放证明这些既有历史的兼容性，不证明新 owner 要求的正向 history、
owner 与角色混合票、撤权窗口或 Tenant 删除业务链已经实际验收。
没有制造 Tenant、Resource、owner、审批对象或新 history 来把无适用对象改写成通过。

本次没有执行发布构建、部署或 Git push，也没有单独运行全局门禁。
文档和批次最终门禁由批次负责人集中执行；此处不把局部退出 0 称为全量门禁通过。
公开 `tenant.delete` 注册仍受 `DD-99/109` 的既定销毁处理器门禁约束，
这份 Worker 判定修正不解除它，也不改变三端治理或入口边界。
