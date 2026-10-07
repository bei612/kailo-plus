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
| 一期登记的动作 | `workspace.create`、`workspace.member.add/revoke`、`tenant.member.revoke`（需另一位 Tenant admin 批准，`self_approval=DENY`）、`identity.client_key.register/revoke`、`tenant.admin.grant/revoke`（撤销需另一位 Tenant admin 批准）、`workspace.admin.grant/revoke` | Tenant delete 受 `GAP-LCM-01` 阻断、Workspace delete 按 `DD-46` 不注册；Tenant 成员邀请 `tenant.member.invite/invite.revoke` 与由兑换发起的 `tenant.member.admit`（`DD-83`）见 [tenant-invitation.md](tenant-invitation.md)；角色动作见 [role-management.md](role-management.md) |
| 设备公钥登记是否改走同一准入 | 是。定义在所属 Tenant 上检查 `discover`（固定 schema 没有 principal 上的 permission；`tenant#member` 撤销后即为假）；持钥证明、设备上界与 binding 状态机留在 `client_keys` | `apps/AGENTS.md` 规则 9；`.design/03` §4「每个治理入口都有 operation_id 和 ActionDecision」 |
| 选择器与 owner 要求无对象时 | 请求不启动（`APPROVAL_SELECTOR_UNRESOLVABLE`），不换用更宽角色 | `.design/10` §2 |
| 批准到派发的时间窗 | 派发前要求距 consume 截止至少 `APPROVAL_DISPATCH_MARGIN_SECONDS`；不足即不派发、让批准按期失效；已派发而 consume 被拒记 RECONCILIATION 审计 | `.design/06` §4 要求「dispatch 成功后才 consume」，二者之间的竞争必须有确定处理 |
| 审批 Workflow 的 ID | `kailo:APPROVAL:<tenant>:<action_execution_id>:1` | 沿用 `kailo:<kind>:<tenant>:<entity>:<version>` 使其可机械校验；一个 ActionExecution 至多一个 ApprovalWorkflow |
| 审批的 continue-as-new | Server 建议续跑时在安全点续跑（写回失败一轮后，或状态已全部写回的主循环），排空 handler，冻结 input 原样加 `resume`（状态、决定、资格结论、consume 截止、event_id 基数）；`approval-continue-as-new` 门控 | `.design/06` §3；在途资格判定以 `DEPENDENCY_UNAVAILABLE` 交还、Core 映射为 503，同一 Update ID 在新 run 重发 |
| EVALUATING 的终结 | 超过 `ADMISSION_EVALUATION_TIMEOUT_SECONDS` 由对账作业置 `EXPIRED`（`ADMISSION_ABANDONED`）；同幂等键重试在此之前继续判定 | 每个新状态必须回答怎么终结、多久终结 |

## 用例与断言面

`core/crates/kailo-core/tests/governed_action.rs`（端到端）、
`worker/workflows/approval_test.go` 与 `approval_can_test.go`（状态机与续跑，时间可跳跃）、
`worker/replay-tests`（录制 history 回归）、
`core/crates/kailo-core/tests/drill_approval_continue_as_new.rs`（续跑演练，由
`core/verify/drill-approval-can.sh` 在压低续跑阈值后调用）、
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
- `go test ./workflows/` 10/10（含续跑三例）；`replay-tests` 三组全过（Approval 7 份——其中 3 份是续跑演练录制的同一条审批的三个 run——ComponentTask 8 份、baseline）。
- 续跑演练 `DRILL_CAN_HISTORY_COUNT=18 bash core/verify/drill-approval-can.sh <目录>`（2026-09-24）：1 passed，同一 workflow ID 3 个 run（两次 `CONTINUED_AS_NEW`、最后 `COMPLETED`），续跑后的写回被 Core 采纳，B 的决定跨 run 保留并被消费。

## 2026-09-26 同版本与升级版本 history replay

现阶段 active 的两类业务 Workflow 各补录一份当前本地 Worker 执行的完整终态 history，均通过 Temporal CLI `workflow show --output json` 从运行中的 Server 导出，不是手造事件。`ComponentTaskWorkflow` 的 `MEMBERSHIP_PROJECTION` 录于 17:43:42–17:43:43 UTC，共 35 个事件，入库为 `worker/replay-tests/testdata/component_task_20260926_history.json`，SHA-256 为 `c71f8cda75c2e66e8e52ba6f3fe1296228dd01d9e200819c7dc874303ce33780`；`ApprovalWorkflow` 录于 17:43:16–17:43:18 UTC，共 57 个事件，入库为 `worker/replay-tests/testdata/approval_20260926_history.json`，SHA-256 为 `917473bc4db6e81f9856ec46493e1d0a50a770f3f7ffd87053891060b10ed747`。两份文件的 digest 均与再次从 Server 导出的字节逐一相等。运行中的 Worker 镜像为 `sha256:e44c62179519bd095a1aeea7f8b2a73ba260eb309d2ee04d60892b808b94e4ee`，2026-09-26 03:01 UTC 创建；当前源码从 `d90f6af3d9145da8d2d00c7255f7702d3907e771` 到 `a49812233b5668879c7be64af05b3d5362f8ebb6` 的 `worker/workflows`、`worker/main.go` 与 `worker/replay-tests` 无差异。当前源码对这两份本地运行 history 的重放已通过；早于当前 Workflow 代码的 ComponentTask 与 Approval history 继续验证升级重放，含 `GetVersion` 门控之前的分支和 continue-as-new 的三个 run。导出的 JSON 明文与解码后 payload 均未匹配凭据关键词。

为核验当前运行镜像与源码确为同一可执行行为，先从运行中容器提取 `/usr/local/bin/kailo-worker`；其 `go version -m` 显示 Go `1.25.14`、`CGO_ENABLED=0`、`-trimpath=true`。在干净的 `7d187de` 源码上，用相同 Go 版本、`CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags='-s -w'` 于 8 GiB/400% cgroup 内重建。两份原始二进制 SHA-256 不同；`cmp -l` 精确给出 77 个差异字节，全部落在 ELF `.note.go.buildid` 与 `.note.gnu.build-id` 的文件偏移 3961–4096 内。用 `objcopy` 仅移除这两个 build-ID note 后，两份二进制 SHA-256 同为 `578cc6118a2ca2fd71a6cc714771ed8632c8069e3a12d63c324191b6b25070ab`。因此本地运行 Worker 的可执行内容与当前源码重建结果一致，同版本 replay 的运行产物关联有直接字节证据；这不把旧本地镜像伪装成已随镜像发布的 SLSA provenance，正式发布仍须按 ADR-06 用 `tools/release.sh` 将来源断言绑定镜像 digest。

在受限 cgroup 中执行 `go test ./replay-tests/... -count=1 -v`：Baseline、ComponentTask、Approval 三组均 PASS。将新录制的 ComponentTask history 中 `Converge` Activity 名临时改为 `ConvergeCorrupt`，同一 replay 报 `[TMPRL1100] nondeterministic workflow` 并退出 1；还原 JSON 后重跑退出 0。这证明新增 history 实际进入门禁，且门禁能识别命令不兼容。该 replay 检查不比较 Activity timeout/retry 选项，仍按本文件前述边界审查。

## CapacityLease 退出门禁的适用性（2026-09-25）

Stage 2 退出门禁「Activity heartbeat 超时不会直接复用 Capacity slot」本次结论为**无适用对象，通过**，不是声称已有 CapacityLease 实现。`core/migrations/20260924100000_governed_action.up.sql` 的 `capacity_not_yet_enforced` 约束固定 `capacity_policy = 'NONE'`；本机已部署的 Core 库执行 `SELECT status, capacity_policy, COUNT(*) FROM catalog.action_definition GROUP BY status, capacity_policy` 得到 `ACTIVE|NONE|13`，查询 `pg_constraint` 得到 `CHECK ((capacity_policy = 'NONE'::text))`。故当前 13 个 ACTIVE 动作都不持有平台 slot，发生 Activity heartbeat 超时时没有可复用的 CapacityLease。首个实际适用对象是 Stage 5 的 Codex runtime pool（`02-纵向交付路线.md` §7、`.design/03` §8）；注册 `PLATFORM_SLOT` 动作前，该门禁须以真实 lease、heartbeat 超时后的 UNKNOWN、终态证据和恢复对账重新核验。现阶段不创建空池、假 lease 或没有调用方的容量代码。

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
| 续跑不带决定 | `TestContinueAsNewCarriesFrozenInputAndDecisions`、`TestContinueAsNewResumesWithoutLosingDecisions` 失败（B 一人批准后仍 WAITING） |
| 关掉续跑 | 录制的 `approval_can_1_waiting_history.json` 报 `TMPRL1100`（多出 StartTimer） |
| 无条件续跑（不看门控与建议） | 门控前录制的 `approval_consumed_history.json` 报 `TMPRL1100` |

## 2026-09-26 本人任务取消动作核验

`20260926120000_task_cancel_catalog.up.sql` 只为四个已登记的业务 Workflow 动作注册取消控制定义，保留各自 Tenant/Workspace 与 SpiceDB 权限合同。`governed_action` 在真实 Core、Temporal、Worker 拓扑中验证：控制动作按原 ActionExecution 定位，首次 run ID 在调用前冻结；控制动作的 `DISPATCHED` 只由匹配控制 ID 的 Temporal history 事件证明；同键重试从同一 history 对账，新键重复取消被拒；Worker 恢复后原任务投影进入 `CANCELED`。测试结果为 `1 passed; 0 failed`，耗时 116.25 秒。首次运行因部署中的 Worker 镜像早于取消终态投影修正而在该投影处超时；重建并替换 Worker 后复跑通过。夹具拆除时曾先尝试删除仍被额外成员引用的 IdentityProvider，日志出现一次外键错误；后续 `teardown_members` 收尾，本次夹具 Tenant 与 ActionExecution 残留计数均为 0。该日志顺序问题未作为业务能力修复。取消请求记录不等于原任务已经终止，工作台须继续读取原 Workflow 的终态证据。

新 Web 镜像 `sha256:ec6d609d8c58652850468346cb2039c322d08cb0c00a967b39e7a7193faea770` 上的真实浏览器走查也覆盖了本人取消：临时停止原本运行的本地 Worker，创建原 `workspace.create` 任务，从任务详情提交取消控制；浏览器先看到控制 operation，而原任务在 Worker 停止期间未被伪报为 `CANCELED`。控制任务经 Temporal history 投影为 `DISPATCHED`，恢复 Worker 后原任务才显示 `CANCELED`，旧的“尚未确认取消”提示随终态消失。`core/verify/web-walkthrough.sh` 退出时恢复原 Worker 再拆夹具。走查退出码 0，17 个主场景通过，`summary.json` 有 26 条记录、CSP 违规 0；证据位于 `/volumes/data/kailo-web-cancel-zzolQL/`。人为断开 BFF/Relay 的预期 503 和拒绝操作的 409/403 仍在 `failedResponses` 中，不计为浏览器通过之外的服务健康结论。Desktop 原生端本增量未做端到端验收，用户重跑尚未接入 Governed Action。

## 2026-09-26 本人任务重跑动作核验

`20260926150000_task_rerun_catalog.up.sql` 为已登记的四种业务 Workflow 注册独立的重跑控制定义。控制动作以原 ActionExecution 为目标，重新走 scope、SpiceDB fresh Check 与原动作所需审批；原 Workflow 的关闭事实由 Temporal 核验，新实体版本与固定的新 Workflow ID 才被分配。同一个控制意图的重试只对账，不再启动第二个 Workflow。`governed_action` 在真实 Core、Temporal、Worker 拓扑复跑结果为 `1 passed; 0 failed`，耗时 105.22 秒；夹具拆除不再出现 IdentityProvider 外键错误。重跑审批策略已独立登记并在准入时与原策略逐字段核对，但本次真实重跑对象是无需审批的 `workspace.create`，不能把它算作重跑审批端到端证据。

Web 镜像 `sha256:3a23b71a80045bf337a8ee4af9c54dde1fc53cbfbba275ba39ccd4db4371d61e` 上，真实浏览器从已取消的原任务详情提交重跑控制，打开新任务并观察 `WORKSPACE_LIFECYCLE` 完成；原任务仍保持 `CANCELED`，新 Workflow 使用实体版本 2。`core/verify/web-walkthrough.sh` 退出码 0，`summary.json` 有 28 条记录，其中 19 条有计时，CSP 违规与意外 origin 均为 0；证据位于 `/volumes/data/kailo-web-rerun-fixed-VGf2mO/`。故意断开 BFF/Relay 与拒绝操作产生的 503/409/403 仍只算预期故障注入。此结果只证明 Web，不代表 Desktop/Mobile 原生端验收或整个 Stage 2 完成。

共享任务页的回归检查还做了反向验证：故意把「取消已提交」误判为「重跑已提交」，`governance.test.tsx` 的取消后可重跑断言按预期失败（1/57）；恢复原逻辑后 57/57 通过。最终 `./tools/check.sh --full` 十项全过；实际数据库迁移回退演练因未向门禁提供隔离 `DATABASE_URL` 而跳过，迁移已在当前 Core 库前进并由真实链路使用。

### 需审批原任务的重跑闭环

`governed_action` 在同一真实 Core/BFF、SpiceDB、Temporal、Worker 拓扑中增加 `tenant.member.revoke` 场景。测试先让原动作的 Temporal Approval 到 `APPROVED`，以夹具 Tenant 行锁阻止业务派发；停止 Worker 后解锁，原业务 Workflow 才派发。用户经 BFF 提交取消，Worker 恢复后原 Workflow 为 `CANCELED`、原审批为 `CONSUMED`、目标仍为 `REVOKING`。本人随后提交专属 `task.rerun.tenant.member.revoke.v1`，新业务 Workflow 在第二份独立 Approval 批准前不存在；发起者自批被拒，另一 Tenant admin 批准后出现 `RECHECK` 且审批为 `SATISFIED`，第二份批准 `CONSUMED`，新 Workflow 唯一并达到 `COMPLETED`，成员达到 `REVOKED`。恢复后定向集成命令退出码 0：`1 passed; 0 failed`，耗时 104.82 秒。

反向核验把这次重跑请求临时指向 `task.rerun.workspace.create.v1`；Core 返回 `403 BLOCKED/CAPABILITY_BLOCKED`，验收在预期断言处失败（退出码 101，123.92 秒）。恢复正确 action key 后重新取得上述 1/1 通过。三轮集成都在 `MemoryMax=16G`、`CPUQuota=500%` 的 cgroup 内执行；只改了验收场景，没有改产品 Catalog 或运行服务配置。此证据覆盖 BFF 用户控制到 Temporal/Worker 的真实后端链，不把它冒充 Web 页面上的第二次审批操作走查，也不代表 Desktop/Mobile 验收。

### Web 上的第二次审批走查（2026-09-26）

权威为 `.design/02` DD-84、`.design/06` §9 与 `.design/16` V-SCN-68：重跑使用新控制动作和独立 Approval，旧批准不能复用，批准前不得派发新业务 Workflow。影响面仅为既有浏览器走查夹具与脚本；`Governance` 夹具增加原 ActionExecution ID 和另一管理员的测试 subject，未改产品 API、合同、数据库或 Web/Worker 代码。GitNexus 对夹具 `Governance` 报 LOW（调用链到 `prepare_governance`、`main`）；浏览器脚本文件报 UNKNOWN，已用文本核对唯一调用者 `web-walkthrough.sh`，不把零图边当作无调用。测试 actor 仅经本机 BFF 入口发送受测身份 header；真实浏览器仍经 AgentGateway、OIDC 和同源 Web 页面。Tenant 行锁与短暂停 Worker 复用后端集成已验证的顺序，脚本退出恢复 Worker、Relay、Core 并拆除夹具，不涉及旧 K8S。

`systemd-run --user --scope -p MemoryMax=16G -p CPUQuota=500% -- bash core/verify/web-walkthrough.sh /volumes/data/kailo-web-approved-rerun-final-U6zCxP` 退出码 0。`summary.json` 有 30 条记录、20 个计时场景、意外 origin 与 CSP 违规均为 0。浏览器先批准原 `tenant.member.revoke`，测试 actor 在原 Workflow 仍 OPEN 时请求取消；恢复 Worker 后原任务为 `CANCELED`。测试 actor 请求专属重跑时产生不同的 Approval ID；浏览器批准第二份审批前，重跑任务 `WAITING` 且无业务 Workflow；浏览器从审批箱打开新审批并批准，随后新任务 `COMPLETED`、新批准 `CONSUMED`、新 Workflow ID 与原 ID 不同，原任务仍为 `CANCELED`。首次投影尚未生成时 BFF 对审批详情返回 `422 TARGET_NOT_FOUND`，走查只允许该确定瞬态及 `REQUESTED`，其他非 `WAITING` 结果立即失败。最终 Core 会话 `REVOKED`，原走查夹具的撤回审批 `CANCELLED`、批准审批 `CONSUMED`；`fixture.log` 确认 Workspace 已拆除，受控 Compose 的 Core/Relay/Worker 均恢复运行。

灵敏度反向验证：临时把浏览器走查所要求的 `task.rerun.tenant.member.revoke.v1` 改成不存在的 action key，`/volumes/data/kailo-web-approved-rerun-negative-iITJm7/` 这次走查在新场景明确报“原动作重跑控制不符”、退出码 1；其夹具同样拆除。还原期望后，取得上述最终退出码 0。此次运行的 Web、Core、Worker 镜像 ID 分别为 `sha256:3a23b71a80045bf337a8ee4af9c54dde1fc53cbfbba275ba39ccd4db4371d61e`、`sha256:dd14002f2b99d198edbfe1b621ebe10807e5029fd1232809c2ab9fd0b3ca73aa`、`sha256:e44c62179519bd095a1aeea7f8b2a73ba260eb309d2ee04d60892b808b94e4ee`。此结果闭合 Web 审批者的第二次审批操作；请求者一侧由本机 BFF 测试 actor 驱动，同一走查的另一场景独立覆盖浏览器发起普通重跑。它不等于两个真人 Web 会话同时操作，更不代表 Desktop/Mobile 验收或整个 Stage 2 结束。

## 2026-09-28 CLIENT 身份投影重跑核验

依据 `.design/02` DD-84、`.design/06` §9 与 `.design/09` §4，原身份投影的 Temporal 终态与 TaskProjection 必须匹配，重跑才以原 ActionExecution 为目标重新准入，推进 binding 版本并分配新 Workflow ID。改动落在既有 `task_rerun` 核心、两条 Catalog 控制定义与其追溯记录；没有新增任务引擎、审批权威或 Web 专有路径。原 Workflow ID 的实体段在身份投影中是 64 位小写公钥，而原动作 target 是 Principal UUID；旧解析器只接受 UUID，因此不能重跑身份投影。本轮按原 action key 锁定投入或撤销方向，只为 `identity.client_key.register/revoke` 的 CLIENT HUMAN binding 发布控制定义，SERVER 密钥控制仍不在 Catalog 中。

影响面由 GitNexus 先查 `preflight`、`eligible`、`rerun`、`start`、`parse_workflow_id` 与 `resolve_target`，包含任务详情、Governed Action 准入与派发；`start` 为 HIGH 风险，版本解析器为 CRITICAL，未把零调用或不完整图边当作安全证明。准入时验证原发起者、原动作版本、同一 Tenant/Workspace、binding 的 Principal/custody/kind 与 fresh SpiceDB Check；版本解析拒绝零、负数和 `i32::MAX`，避免下一版溢出。派发时用版本及收敛中状态 CAS，旧终态不一致或 Temporal 观察不明返回拒绝，不分配第二条业务 Workflow。同一控制 ActionExecution 重发只对账原新 Workflow；不同控制键不能跨登记/撤销方向借权。异常收口按 `apps/06` §4：权限与 scope 错配为确定拒绝，版本竞争为冲突，外部终态或投影证据缺失为结果不明，重复投递走幂等对账；不会把结果不明渲染成成功。

本地先应用 `20260928100000_identity_rerun_catalog`，再以真实 Temporal/Worker/Relay 跑 `identity_rerun.rs`：登记与撤销各 1 条通过。夹具把旧 Workflow 输入冻结为错误版本，得到真实 `FAILED`；任务详情只给原发起者相应控制键，错误方向返回 `403` 且版本不动，正确方向产生新 Workflow 与 `RECHECK` 决定，最终 binding 分别为 `ACTIVE`、`REVOKED`，版本均为 3。临时把撤销映射改错，专项单元检查准确失败；恢复后通过。正式 `core/verify/run-integration.sh` 退出 0，含新两例，清理本轮 21 个测试 Tenant OpenBao namespace，Core 重启后 BFF `/healthz` 返回 200。`./tools/check.sh --full` 在真实数据库可用、但不打开集成开关的环境下 10 组全绿，迁移前进、回退、再前进均实际执行。

首次专项用例未出现控制键，是本地数据库尚未应用新 Catalog 迁移；应用后原用例通过。直接以 `KAILO_INTEGRATION=1` 跑整个 Cargo workspace 会让 OpenBao 一次性凭据用例缺 `OPENBAO_ROLE_ID`，不属于产品链路结论；正式入口先即时投递凭据再运行该用例，已通过。本轮没有对 CLIENT 身份重跑做浏览器点击走查，也没有 Desktop/Mobile 端到端验收；SERVER HUMAN 管理密钥动作仍须闭合 OpenBao 写入与 WorkflowRef 预写之间的结果不明风险，才能进入用户 Catalog。

## 2026-09-28 Web 创建 Workspace 在途可见核验

角色页读取 `RoleWorkspacePage.createActionKey`（Core 以只读准入判定、Tenant `create` 走 FullyConsistent Check），有该键才渲染创建表单；在途的 `workspace.create` 由本人任务列表（`/api/v1/tasks`，`admission.action_execution` 权威）中 `taskPhase` 为中性的条目列出，读取失败显示不可用并要求先到任务页确认，不假定没有在途请求。

新 Web 镜像 `sha256:37be2e799141107be68eab9fc06d580f26614359d1dee2453cb8b9d869488fa4`、经 `start-core.sh` 重建的 Core 与重建的 Worker 上，以核验用户在真实浏览器经网关登录：暂停本地 Worker 后从表单提交，页面显示「已登记、未确认完成」与 operation；此时执行记录为 `ALLOWED/DISPATCHED`，Workspace 为 `PROVISIONING`。整页刷新后本地幂等键随之消失，表单上方仍列出该 operation，状态为「已开始」。恢复 Worker 后 Workspace 在收敛上界内进入 `ACTIVE`，Buzz binding 1 条；再次刷新后在途列表消失，新 Workspace 出现在成员页选择器中。按本动作既有语义，创建者不自动成为 Workspace 成员，Channel 页因此仍无可进入的 Workspace。浏览中唯一的失败响应是 `legacy-secret-refs` 的 404：该路由未进入发布注册表，组件按设计不渲染。

本轮没有完成完整 Web 走查：`web-walkthrough.sh` 的夹具在准备阶段被 `TENANT_SELECTION_NOT_AVAILABLE` 拒绝，原因见 `apps/07` §2。

## 已知边界

- 「待我审批」列表用低延迟一致性：刚授予的 admin 关系可能要等 SpiceDB 的
  quantization 窗口才出现在列表里；决定本身以 FullyConsistent 判定，不受影响。
- 列表先按 Core 索引取一页、再逐条判定资格，一页里不合格的被滤掉后可能少于页长。
- 审批空闲等待时没有写回，停掉 Core 不会让 history 增长；「Core 不可达、写回逐轮失败后
  续跑」由 `worker/workflows/approval_can_test.go` 在测试环境核验，真实 Server 上的演练
  覆盖的是安全点续跑。测试环境不计 history 长度，event_id 基数跨 run 单调由演练证明。

## 2026-10-02 18:12 UTC Codex Capacity 与 AgentTask 消费事实

依据 `.design/03` §8、`.design/11` §2、`DD-47/48/69` 与 Stage 5 的
Activity heartbeat 退出门禁。前文 2026-09-25 的 NONE/无适用对象是当时
运行版本的事实，保留不改；本批已有真实 PLATFORM_SLOT 消费代码，不能
继续借该历史结论宣称新 lease 的超时/终态行为已经验收。

`capacity.rs::acquire_or_renew/renew/begin_release/reconcile` 复用唯一 Core
CapacityLease 与现有 Temporal 客户端。真实 Invocation、ActionExecution、
operation/scope、Workflow 首个 run 链与 SDK ActivityID/attempt 先匹配，再
读取同一 Activity 的 scheduled event、pending heartbeat/timeout 或 terminal
history。pool 行锁串行分配；SDK retry 只更新原 holder attempt，不另占 units。
不同 run/Activity 不能接管未释放 holder；到期、查询失败或失联都保留 UNKNOWN
占用，不以超时直接回池。原生 turn 终态或确定未派发取消只进入 RELEASING，
还需原 holder 的 Activity terminal event 才 RELEASED。配套实际迁移为
`20261002180000_platform_capacity.up/down.sql`，没有给业务能力服务造 lease。
原治理对账节拍已调用该 reconcile，保留 occupied/unknown/oldest 指标。

Core `agent_task.rs::advance/release_holder` 与 Worker
`activities/agent_task.go::AdvanceAgentTask` 消费同一 `finishActivity` 字段。
结束 Activity 不等于完成 Invocation：真实 holder 未释放时只要求 Activity
收尾；RELEASED 后的 Running/finishActivity=true 只观察原 Invocation 的
计量/回复结果，不占新 units。Completed/Failed/Canceled 回应需真实 RELEASED，
Worker 再确认同一 TaskProjection event 的 ACK 才关闭 Workflow。native terminal、
HTTP 200、取消已接受或 Activity 返回都不单独证明业务完成；缺 durable usage/
reply 保持 Running/BILLING_UNAVAILABLE，不写零用量或伪终态。

本 lane 已修 `worker/workflows/agent_task.go` 初始投影失败的真实缺陷：原先
直接 return error 会把 ACK/传输不明变成 Workflow FAILED；现在沿既有持久
timer 和 continue-as-new 安全点重查，投影 ACK 未成立前不调用 Advance 或
取得 runner。CancelPending/EventBase 与原冻结 Input 跨 run 保留，不新增
Input 或 Workflow 类型。`worker/activities/agent_task.go` 核对后未修改；其
SDK holder/heartbeat、缺字段/未知状态拒绝和 terminal/finishActivity 核验仍保留。

Worker 精确 before/after 位于
`/volumes/data/kailo/tmp/codex-agent-task-capacity-before-20261002.VaMQ7H/`，
于 18:06:45 UTC 停写。workflow SHA-256 为
`20ce30310ba15acd446f0e1dc6150f5abb8cb94cf883bce320a13f0337d4bd2f`；
activity 未变，SHA-256 为
`4d83425aad30ca65bbcdf8bdabd8aa236a4534e86889eb1d525af51143164b9e`。
选定两路径 `git diff --check` 实际退出 0；没有 SDK 或新 AgentTask 正向演练。
现有 replay 只有既有 Approval/ComponentTask/Baseline history，没有本批
AgentTask 录制 history，不用旧 replay 通过冒称新流程兼容验收。

现有 `tools/check.sh` 已覆盖 lint、既有 verify、contract、migrate、replay、
trace 与 docs，不新增检查脚本。生成物漂移、缺配对 down、命名枚举与数据库
约束漂移均有原检查对象；它们的失败不能替代 lease/Memory/Installation
业务断言。现有 checks 未包含本批新 holder 释放和原生 Memory 分支的直接
断言；本 lane 没有可执行的对应负向业务对象，也没有破坏/还原业务对象或
造 Tenant、Invocation、event/history 充验收。SDK、实际数据库与负向结果
只认主线之后的原始日志。本节尚未运行 docs 门禁，由批次负责人集中执行；
本批未提交、未部署，不提高 Stage 或生产完成度。

## 2026-10-05：未派发 Invocation 的 Capacity holder 恢复

本次基线为 `6112fdb6dfbdee9897a34e374988e6d79f37406c`。真实故障为旧
Activity 已终结，新 Activity 已开始，但旧 lease 仍 UNKNOWN；原实现把
整个 Workflow 关闭作为 CREATED 的收口前提，活 Workflow 因而无法前进。
这不是容量不足，也不能通过到期释放或重新发起 Invocation 解决。

四步影响结论：

1. 权威是 `.design/03` §8、`11` §2、DD-47 的原 CapacityLease 与 Temporal
   holder/终态。复核只读上游 `temporal-sdk-go` 完整提交
   `b7c242c6894df088a57a85b33d0586e908da8b93`，路径
   `temporal-sdk-go/activity/activity.go::GetInfo` 与
   `temporal-sdk-go/internal/activity.go::ActivityInfo`；不新增调度器。
2. 实际写者为 `capacity.rs::acquire_or_renew/recover_unstarted`，消费者为
   `agent_session.rs::birth` 和原 AgentTask 调用；原 reconcile 比对完整
   run/activity/scheduledEvent，丢弃移交前读到的旧观察。19000 配对迁移
   修改原 lease guard，旧 holder 终态在原 append-only AuditEvent 留证。
   不改四侧线格式、运行配置、Agent 权限或业务用量。
3. 移交仅发生在原 Activity 确切终态、新 Activity 原生 Started/heartbeat
   有效、同 Invocation/generation/Workflow 执行链，且数据库锁内证实
   CREATED、Session PENDING、无 thread/turn/native status/reply/trace/usage。
   全程同一 lease ID/units/operation/scope，没有 RELEASED 空窗。
   birth 在提交 STARTING 前按同一 pool→lease 顺序锁住 exact holder；
   迟到旧 HTTP 请求不能借新 holder 的 HELD 状态创建 thread。
4. 缺终态、未知原生状态、取消、过期 heartbeat、错 generation、STARTING
   或 UNKNOWN Session 均保留不可派发状态。旧 terminal 与新 schedule
   同事务关联审计；事务失败不移交。已有 native UNKNOWN 不在本修复的
   可重试集合内，仍沿原生观察收敛，绝不推断成功或失败。

实现后证据位于
`/volumes/data/kailo/tmp/codex-capacity-holder-recovery-20261005.fAEvCi/`。
原受限 SDK `kailo-installation-scope-sdk-e4agxd` 使用固定镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU、8 GiB、无额外 swap、Cargo 16、原 Data cache。

- 独立库 `capacity_holder_faevci` 的模板实际为 80 条/max17000/失败0，
  不是摘要中的81条。原 `sqlx migrate run` 补固定16000及19000后，
  读回 `82|20261005019000|0`；19000 原 `revert`→`run` 均退出0。
- `cargo test --locked --offline -p platform-core --bin platform-core
  capacity::recovery_tests -- --ignored --nocapture` 实际1 passed/0 failed；
  `cargo clippy --locked --offline -p platform-core --all-targets -- -D warnings`
  退出0。目标使用原生产恢复函数与真实迁移约束，验证 UNKNOWN 不移交、
  在途 Session 拒绝、错 generation 拒绝、同 lease 恢复、审计13→26、
  旧 holder 拒绝及同 holder 重试不新增槽位/审计。
- 在隔离执行副本移除 birth SQL 的 activity/attempt 精确匹配，原目标
  实际退出101/1 failed：`late old HTTP request cannot borrow new HELD lease`。
  用 `apply_patch` 还原，`cmp` 为0，原目标恢复1 passed/退出0。
- `target.log` SHA-256：`4680c8759fb38d3d5ac055d7200fd0c0cf3b17c4a615253c8cd0d7e52a2c1b07`。
  `mutation.log`：`03f81ec6dbda7561fe19adcb42514070af8aee68765dd53d3cbfb797b8ffc72c`。
  `restored.log`：`ea423bf6fb56e173eafabe9d97255edb31aa13db3f35fb9ded4d160d61ce78d6`。
- 用例事务已回滚；最终独立库82条/失败0、其它连接0。仅删除本次独立库，
  原生读回不存在（0）；没有删除 PG、模板库或业务对象。

本切片未运行 full、产品构建、部署或真实模型回合；docs 由主线合批。
这证明本地原恢复消费者和持久约束，不声称两个线上 Invocation 已恢复。
最初 runtime admission 拒绝属于另一个实际 SQL 接缝，由主线独立修复；
本补丁不能用容量恢复掩盖该准入拒绝。

## Automation 原管理 AE 的联合原生回执（2026-10-05）

本切片对应 DD-107、`.design/03` §7 AutomationDefinition 与 SecretRef、
`05` §2.9。它收口原 Schedule 与 Tenant OpenBao 引用的管理副作用，
不是公开 WEBHOOK 触发验收，也没有注册尚不能真实运行的 Webhook 入口。

四步变更边界：

1. 继续复用原 SYNC Action Admission、AE 恢复驱动、Temporal Schedule
   和 SecretStore；不新增 Workflow、调度器、Secret 账本或执行权威。
   固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
   `buzz/crates/buzz-relay/src/api/bridge.rs::workflow_webhook` 是旧共享
   secret header/query 路径，不能替代 DD-107 的 HMAC/timestamp 准入。
   固定 OpenBao `735723da5628148f232497a48a35a137b6512103` 的
   `openbao/internal/builtin/logical/kv/path_data.go::versionedKVBackend.pathDataWrite`
   真实调用 CAS 校验；`openbao/internal/builtin/logical/kv/path_destroy.go::versionedKVBackend.pathDestroyWrite`
   按给定版本销毁。删除 ACK 本身不代表对象曾存在或版本已核验。
2. 真实调用链为原 `management_prewrite` 冻结同 AE 两种原生意图，
   `defer_management_dispatch` 保持可派发，原 `management_dispatch`
   先核验 Secret 再收敛 Schedule。各原生消费者读回后记录自己已完成；
   `complete_management_intent` 只在所有现存意图齐全时清原 Resource
   projection fence，并调用原 `record_dispatch` 写同一终态/审计。
   重入不换 AE、operation、scope、Schedule ID 或 Secret locator。
   原 Schedule-only 行无新字段也能继续收敛；没有四侧线格式变更。
3. Secret 明文只在原 OpenBao 客户端内存中存在。每个原 AE 独占
   CAS=0 路径，丢 ACK 后读取确切 version=1；不再用进程内标记推断
   写入是否发生。旧引用必须属于同 Automation/Tenant/Workspace 的
   原 enable/rotation AE，且既有 Invocation、Workflow、capacity 与
   usage 全部收敛后才销毁。不因 initiator 撤权向其披露新密钥。
4. 只完成一项、依赖失败、未知版本和未收敛旧执行均保持 UNKNOWN 与
   projection fence。Secret 准备被撤权时清理自己的 CAS 路径；只有
   Schedule 两个外发标记仍为 false 才能恢复旧配置，不能重造已删除的
   Schedule。Secret-first 顺序避免本实现先删旧 Schedule 再准备新密钥。
   rotate 不改变旧正文或运行记录；没有新模型调用、额度或权限写入。

公开触发正文目前没有已冻结且已实现的可恢复引用生产者，不能写进
Core/Temporal，也不能自造 Relay 正文路径。NONE 管理结果不向浏览器
返回 HMAC 密钥；外部发送方的受控交接尚未成为现有 BFF 消费者。
本切片没有开放这些入口，不将内部生命周期代码等同 Webhook 全链完成。

实现后原件位于
`/volumes/data/kailo/tmp/codex-workflow-webhook-20261005.Vw8Snz/`。
原固定 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
实查 4 CPU/8 GiB/无额外 swap，Cargo 16、Data 原缓存；没有宿主 SDK。

- `cargo test --locked --offline -p platform-core --bin platform-core
  automation::management_evidence -- --include-ignored`：12 passed，退出0。
  新真实 PG 目标按两种回执顺序调用生产 `complete_management_intent`，
  第一项后 AE 仍 UNKNOWN、Resource 仍锁定；同项丢回应重入不解锁；
  第二项完成后原 AE DISPATCHED、原 fence 清除。旧准入目标同时覆盖
  Schedule-only、Secret-only、两者并存及 UNKNOWN 不重置。
- `cargo test --locked --offline -p secret-store`：17 个本地/HTTP 目标
  通过。新增目标拒绝错 Automation/AE/version/audience，并实际发出
  原 metadata→destroy→metadata 请求，丢 destroy ACK 后只以确切版本
  destroyed 回读成功。真实 OpenBao 集成用例没有启用
  `PLATFORM_INTEGRATION=1`，其空返回不计原生部署验收。
- `cargo clippy --locked --offline -p platform-core -p secret-store
  --all-targets -- -D warnings` 退出0（`webhook-secret-restored.log`）。
- 隔离副本将生产联合判断 `all` 改成 `any`，Core 两项实际失败/101；
  删除 Secret 版本守卫，原 HTTP 目标实际失败/101。随后 `apply_patch`
  还原，两源 `cmp` 为0；rustfmt check、Core 12项、SecretStore 17项
  恢复退出0。`webhook-mutation.log` SHA-256
  `ca7d8566eff893766afee561d1ddc948fa5c0a49a550b928eb34b6de103f05b8`；
  `webhook-final-restore.log`
  `ff03e8d591ad72e2b431d059a6de993aebde0bb9cd8d7293db56740c71cf3320`。
- 原失败全部保留：首轮多余 unwrap 与共享旧 contracts/SecretStore
  缓存；仅清两个包后重新编译。旧 RUN 用例读取 SDK 默认旧库报42703，
  显式将两种数据库环境变量投递本专库后通过。SecretStore 后置夹具
  曾使用该 crate 未启用的 UUID v4，并漏一次 metadata 读取；均按原
  crate/真实调用顺序修正，没有放宽生产实现。
- 专用库 `schedule_dispatch_verify_vw8snz` 实际80迁移/max17000/失败0，
  用例事务回滚，结束确认其它连接0后仅删除此库，原生读回不存在0。
  未运行迁移、业务库写入、模型调用、full、产品构建或部署；没有
  四侧契约变动，文档快检查交主线合批。

## 2026-10-07：ActionDefinition 生成列与退役状态的原触发器修复

- 权威与根因：DD-88 保留版本正文不可变、状态可退役。原
  `20261005014000_application_catalog.up.sql::catalog.guard_version` 比较
  `to_jsonb(NEW)-'status'` 全部字段；`platform_action_key` 是存储生成列，
  BEFORE UPDATE 时尚未计算，因此仅更新状态也被错误判成正文变更。
  原函数、DDL 以及隔离库的实际生成列/触发器均已核对，不是权限拒绝。
- 影响面：新 up 仅把 action_definition 的 UPDATE 守卫移到 AFTER UPDATE，
  DELETE 保持 BEFORE 及同一个 guard_version；没有排除生成列或任何正文
  字段，没有改变 API、四侧合同、目录权威或 ActionExecution 引用。
  AFTER 抛错仍回滚整条语句/事务；旧正文、历史引用与所有调用者格式不变。
- 边界与副作用：ACTIVE→RETIRED→ACTIVE 不改正文；正文修改仍为 SQLSTATE
  23001，已引用删除仍为原 23001/ActionExecution 错误，不变成 FK 错误或
  fail-open。未引入新状态、自动重放或清理服务。down 恢复原触发器时序，
  也恢复退役缺陷，回滚后不得声称目录退役恢复可用。
- 实现后原 `platform_views::member_action_tests` 增加一个隔离 SQL 用例。
  通过既有 SDK 的 `AGENT_INVOKE_TEST_DATABASE_URL` 使用一次性测试实例
  `component_runtime_lcivus`，全部 DDL、Tenant/Principal/ActionExecution
  夹具都在外层事务回滚；不改业务库、迁移账本或已有目录内容。
  用例实际执行 up/down/up、两次状态更新和全行比对、正文变更失败后的
  savepoint 全部回滚、真实冻结 ActionExecution 引用的删除拒绝。
- 受限原 SDK（4 CPU、8 GiB memory/swap）中执行
  `cargo test --offline --locked -j16 -p platform-core --bin platform-core generated_catalog_guard_roundtrip -- --ignored --test-threads=1`
  实际 1 passed，退出 0。SDK-only 将 up 的 AFTER UPDATE 改为 BEFORE
  UPDATE，原用例在首次状态更新以 23001 失败，退出 101；原字节还原 cmp 0
  后重新编译同一输入，1 passed，退出 0。正式文件未保留变异。
  日志在既有 `projects-directory.wiWDv3` 目录：
  `catalog-generated-guard.log`、`catalog-generated-guard-mutation.log`、
  `catalog-generated-guard-restored.log`。rustfmt 已执行；未运行 full、
  产品构建、部署或生产迁移，发布时仍须由原迁移入口应用这两个迁移文件。
