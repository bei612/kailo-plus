# Governed Action 准入、审批与派发的核验

对应 Stage 2 退出门禁（`02-纵向交付路线.md` §4）中本切片承担的四条：

> 录制 history 在同版本和升级版本 Worker 上 replay 通过；
> 审批不能由 Core 直接改状态，批准后 dispatch 前会重新准入；
> Workflow Start 响应不明不会生成第二个业务 workflow ID；
> 任务投影落后显示 `PROJECTION_DELAYED`，不伪造 terminal；
> `GAP-LCM-01` 仍使 Tenant delete Action 不可见。

链路：BFF 语义命令 → ActionDefinition 确切版本 → scope guard → SpiceDB
FullyConsistent Check → ActionDecision →（需要时）`ApprovalWorkflow` → 批准后完整
重新准入 → 推进实体并以预写的固定 workflow ID 派发既有生命周期 Workflow → consume。
每一环都是真实实例：BFF 经网关身份 header、SpiceDB（HTTP gateway，ADR-10）、
Temporal 与 Go Worker、Relay roster。

## 设计取舍（写在这里，因为它们不是 `.design` 已有的结论）

| 问题 | 结论 | 依据 |
|---|---|---|
| ActionDefinition/ApprovalPolicy 的来源 | 迁移种子（`catalog` schema），版本内容由触发器保证不可变，「缺项不得 active」由 CHECK 执行 | 它们是随平台发布的合同（`.design/03` §4）；部署配置会让「要不要审批」变成可随手改的开关；contracts 只承载类型 |
| ApprovalPolicy 的 `tenant_id` | 本切片不建：只有随平台发布的策略，没有 Tenant 策略管理动作 | 与 Stage 1 的「实体字段子集，随能力追加」同一规则 |
| 一期登记的动作 | `workspace.create`、`workspace.member.add/revoke`、`tenant.member.revoke`（需另一位 Tenant admin 批准，`self_approval=DENY`）、`identity.client_key.register/revoke` | Tenant delete 受 `GAP-LCM-01` 阻断、Workspace delete 按 `DD-46` 不注册；Tenant 成员「建立」没有邀请/开户入口（Stage 1 不注册登录开户），不登记 |
| 设备公钥登记是否改走同一准入 | 是。定义在所属 Tenant 上检查 `discover`（固定 schema 没有 principal 上的 permission；`tenant#member` 撤销后即为假）；持钥证明、设备上界与 binding 状态机留在 `client_keys` | `apps/AGENTS.md` 规则 9；`.design/03` §4「每个治理入口都有 operation_id 和 ActionDecision」 |
| 选择器与 owner 要求无对象时 | 请求不启动（`APPROVAL_SELECTOR_UNRESOLVABLE`），不换用更宽角色 | `.design/10` §2 |
| 批准到派发的时间窗 | 派发前要求距 consume 截止至少 `APPROVAL_DISPATCH_MARGIN_SECONDS`；不足即不派发、让批准按期失效；已派发而 consume 被拒记 RECONCILIATION 审计 | `.design/06` §4 要求「dispatch 成功后才 consume」，二者之间的竞争必须有确定处理 |
| 审批 Workflow 的 ID | `kailo:APPROVAL:<tenant>:<action_execution_id>:1` | 沿用 `kailo:<kind>:<tenant>:<entity>:<version>` 使其可机械校验；一个 ActionExecution 至多一个 ApprovalWorkflow |
| EVALUATING 的终结 | 超过 `ADMISSION_EVALUATION_TIMEOUT_SECONDS` 由对账作业置 `EXPIRED`（`ADMISSION_ABANDONED`）；同幂等键重试在此之前继续判定 | 每个新状态必须回答怎么终结、多久终结 |

## 用例与断言面

`core/crates/kailo-core/tests/governed_action.rs`（端到端）、
`worker/workflows/approval_test.go`（状态机，时间可跳跃）、
`worker/replay-tests`（录制 history 回归）、
`core/crates/kailo-core/tests/native_client.rs`（设备公钥登记的统一准入）。

没有任何一条断言以「BFF 回了 200」为据：门禁、决定与审批状态直接查 Core 库；
成员状态由成员生命周期 Workflow 推进后查库；审批投影的 run 与 Temporal
`workflow describe` 比对。

| 场景 | 断言 |
|---|---|
| 直接允许 | `workspace.create` → WORKSPACE_LIFECYCLE → 新 Workspace ACTIVE；ActionDecision 带 ZedToken；INTENT/DECISION/DISPATCH 审计；同键同参回原 operation，同键异参 `IDEMPOTENCY_KEY_REUSED`；别人的任务不可见 |
| DENY | 成员无 manage → `PERMISSION_DENIED`；非成员 → `SCOPE_GUARD_FAILED`；门禁 DENIED、未派发、实体未动 |
| GAP-LCM-01 | `tenant.delete` → BLOCKED/`CAPABILITY_BLOCKED`，目录里没有该定义 |
| 需审批 → CONSUMED | WAITING 期间实体不动；发起者自批 `SELF_APPROVAL_DENIED`；非 admin 否决 `APPROVER_NOT_ELIGIBLE` 且不终结；另一位 admin 在「待我审批」可见并批准；同值重复幂等、冲突值 `DUPLICATE_DECISION`；RECHECK 决定（ALLOW、SATISFIED）→ MEMBERSHIP_REVOCATION → 成员 REVOKED → 审批 CONSUMED |
| 批准后权限被撤（V-SCN-07） | 发起者失去 admin → 批准 → 重新准入拒绝 → 门禁 REVOKED（`PERMISSION_DENIED`）、审批 INVALIDATED、成员保持 ACTIVE |
| 撤回 | 非发起者不能撤回；发起者撤回 → CANCELLED、门禁 REVOKED |
| 过期 | 登记短时效策略的新版本（Catalog 版本发布，测试后恢复并删除）→ EXPIRED、门禁 EXPIRED；过期后决定 409 |
| Start 结果不明（DD-48） | Worker 停下后提交，模拟 Core 失去 Start 回应 → 任务视图 `EXTERNAL_RESULT_UNKNOWN`；同键重试以同一 workflow ID 收敛为 DISPATCHED，WorkflowRef 仍一条，Temporal 上仍是第一次 Start 的 run |
| 投影落后 | Worker 不写回、超过 `WORKFLOW_PROJECTION_FRESHNESS_SECONDS` → `PROJECTION_DELAYED`；Worker 恢复后 observation 消失、`taskStatus=COMPLETED` |
| 状态机（测试环境） | 批准→consume、同值幂等、冲突拒绝、DENY、过期、consume 截止失效、invalidate 后不可 consume、不合格否决不形成决定、撤回 |

## 怎么跑

- 端到端：`sg docker -c "bash core/verify/run-integration.sh"`（`governed_action` 约 105 秒，
  其中 62 秒等待新鲜度上界；会停启 Worker）。
- 状态机与回归：`cd worker && go test ./workflows/ ./replay-tests/`。
- 录制 history 来源：`governed_action` 打印本次执行的四个审批 workflow ID，
  按 `temporal workflow show --output json` 导出到 `worker/replay-tests/testdata/approval_*_history.json`。

## 实测结果（2026-09-24）

- `run-integration.sh` 退出 0；`web-walkthrough.sh` 14/14。
- `go test ./workflows/` 7/7；`replay-tests` 三组全过（Approval 4 份、ComponentTask 7 份、baseline）。

## 破坏核验（每条都重建 Core 或改 Worker 后实际跑过，均已还原）

| 破坏 | 结果 |
|---|---|
| 跳过批准后的重新准入（强制 allowed） | 场景「批准后权限被撤」等不到 INVALIDATED，超时失败 |
| Core 直接把审批投影改成 APPROVED、不经 Temporal Update | 发起者自批得到 200，断言 403 失败 |
| 派发结果不明后的重试换 workflow ID | 派发不为 DISPATCHED，失败 |
| 投影落后时不报 `PROJECTION_DELAYED` | observation 为空，失败 |
| 设备公钥登记跳过 ActionDecision | native_client「登记没有 ActionDecision：它绕过了统一准入」 |
| Validator 删掉冲突分支 | `TestApproveThenConsume` 报冲突值未被拒绝 |
| WAITING 到期不置 EXPIRED | `TestExpiry` 失败 |
| 调换首次任务投影与审批投影的顺序 | replay 报 `TMPRL1100 nondeterministic` |

## 已知边界

- 「待我审批」列表用低延迟一致性：刚授予的 admin 关系可能要等 SpiceDB 的
  quantization 窗口才出现在列表里；决定本身以 FullyConsistent 判定，不受影响。
- 列表先按 Core 索引取一页、再逐条判定资格，一页里不合格的被滤掉后可能少于页长。
- ApprovalWorkflow 不做 continue-as-new：history 以审批者人数与投影重试轮次为界；
  Core 长时间不可用时投影按 `WORKER_CONVERGE_ROUND_INTERVAL_SECONDS` 一轮一轮重试。
