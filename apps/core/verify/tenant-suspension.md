# 业务 Tenant 暂停与恢复核验

对应 `DD-96`、`.design/06` §7.2 第 1–2 步、`.design/03` §2（PlatformSession、RelayOperatorIdentity）与 §6（`TENANT_ONLY` 的唯一例外）、`.design/10` §5、`SF-BUZ-43`、`SS-BUZ-OPERATOR`、`V-SCN-31` 的暂停部分。Tenant delete、TenantLifecycleSnapshot 与 `access_mode=LIFECYCLE_RESTRICTED` 受限会话随 Stage 3 交付，本记录不涉及，代码中也不预建。

## 动作与准入

| 事实 | 实现 |
|---|---|
| 两个 ActionDefinition | `tenant.suspend`、`tenant.restore`（迁移 `20260928150000_tenant_suspension`）：`target_type=TENANT`、`SESSION_TENANT`、`TENANT_ONLY`、tenant `manage`、`confirmation_mode=EXPLICIT`、无审批、quota/meter `NONE`、`TEMPORAL`、`TENANT_LIFECYCLE`。未登记取消与重跑控制定义 |
| 只在 Catalog 会话准入 | 执行 Tenant（会话 Tenant）必须是本部署的 Platform Catalog Tenant，判据是引导时建立、以 `catalog_tenant_id` 为主键的 RelayOperatorIdentity（`platform_bootstrap::is_catalog_tenant`）；否则在建立 ActionExecution 之前以 `SCOPE_GUARD_FAILED` 拒绝。permission 的 Check 对象因此就是 Catalog Tenant 的 `manage` |
| 参数闭集 | 只接受 `tenantId`（ActionCommand 新增的可选字段）与 `explicitConfirmation=true`；缺确认或带其他参数以 `INVALID_PARAMETERS` 拒绝。`tenantId` 不被任何其他语义接受 |
| 目标 | 目标须为业务 Tenant（不是 Catalog 自身，Catalog 作为目标回 `TARGET_NOT_FOUND`）；暂停接受 `ACTIVE`，或 TenantBuzzBinding 为 `ACTIVE` 的 `ERROR`；恢复只接受 `SUSPENDED`；其他情形 `TARGET_STATE_CONFLICT`。目录形状与语义不一致时 `CAPABILITY_BLOCKED` |
| 准入落定 | 同一事务内：把业务 Tenant 以条件更新置 `SUSPENDING`/`RESTORING` 并 version+1（Core 中唯一的跨 Tenant 写，只对这两个语义开放，影响行数不为 1 按 `TARGET_STATE_CONFLICT` 拒绝）；为业务 Tenant 建立它自己的承接执行（独立 operation、`tenant_id` 为业务 Tenant、`ALLOWED`）、预写它的 `TENANT_LIFECYCLE` WorkflowRef（workflow ID 用业务 Tenant 的新 version），并写业务侧审计，以 EvidenceRef `ACTION_EXECUTION_ID` 引用发起它的 Catalog ActionExecution；Catalog 执行与其审计归 Catalog Tenant，只记下同一 workflow ID 并以 `ACTION_EXECUTION_ID` 引用业务侧承接执行。两侧不共享 operation，不在业务 Tenant 中建立 Catalog Principal 的任何 relationship |
| 派发 | 无论对账作业先驱动哪一条执行，都以 WorkflowRef 的归属（业务侧承接执行）调用 `launch_scope`（`TENANT`、段 `SUSPEND`/`RESTORE`，并核对 Tenant 正停在该段的收敛中状态），两条执行的派发状态一起落定、两侧各写 DISPATCH 审计。确定中止（`ABORTED`）时同一事务把业务 Tenant 从收敛中状态置 `ERROR`（version+1） |

Catalog 管理员的任务视图按 `temporal_workflow_id` 读到业务 Tenant 那条 Workflow 的状态；业务侧承接执行的发起者是 Catalog 管理员，不出现在任何业务成员的任务视图中。

## 暂停期间 fail closed（DD-96(3)）

- `kailo-identity` 的身份解析在选定 ACTIVE TenantMembership 之后核对所属 Tenant 为 `ACTIVE`，否则以新增 reason code `TENANT_NOT_ACTIVE`（分类 `DENIED`，HTTP 403）拒绝；该 Tenant 成员的全部 BFF 请求（含原生入口与 `/api/v1/session`）自 `SUSPENDING` 起在身份解析即被拒，不建立会话。
- 会话存活判定（`session::is_live`）同样核对所属 Tenant 为 `ACTIVE`；已建立的 stream 在下一次再准入时关闭，关流原因标为 `tenant-not-active`（与身份解析的 `TENANT_NOT_ACTIVE` 对应），与会话撤销的 `session-revoked` 分开。
- Governed Action 的评估本就要求发起者所属 Tenant `ACTIVE`。
- Catalog Tenant 自身不在其中：暂停的目标不能是 Catalog，Catalog 会话照常解析。
- Web i18n 与 Mobile 生成的 reason 文案同步新增该 code（en/zh-CN）。
- roster 对账度量跳过 `SUSPENDED` Tenant：其 Community 已归档、host 不再解析，读不到 roster 是设计结果。

## Core service 端点

`POST /service/v1/tenants/community-archive`，body `{tenantId, tenantVersion, archived}`：

- 归档要求 `SUSPENDING`，或 `RESTORING`（恢复在解档之后失败时的补偿归档）；解档要求 `RESTORING`。两者都要求版本一致，TenantBuzzBinding 与 CONTROL binding 都 `ACTIVE`；否则 409。
- 以 RelayOperatorIdentity 调用 operator API，owner 断言取该 Tenant 的 CONTROL pubkey，目标是其 Community host；每次请求都重新签名（新 nonce）。kailo-buzz `operator.rs` 新增 `unarchive_community` 与 `list_owned_communities`，后者对 origin + path + 查询串签 NIP-98。
- 归档每次都重发（上游对已归档的 host 保留原 `archived_at`，重发幂等）：上游 200 才表示集群内连接已断开；上游 503 表示 `archived_at` 已落库而断开传播未完成、上游要求重发，此时回 503 交给 Workflow 重试，不以回读代替。只有上游 200 且 `GET /operator/communities?owner_pubkey=` 回读该 host 的 `archived_at` 非空才回 200。
- 解档没有断开传播：先回读，`archived_at` 已为空即不再发送；发送后以回读为空为准，否则 503。
- owner/host 对不上（404）等确定拒绝回 409；其余结果不明回 503。列表回应缺 `archived_at` 字段按不合合同处理，不当作未归档。

`POST /service/v1/tenants/restore-reconcile`，body `{tenantId, tenantVersion, phase}`，要求 `RESTORING`：

- `BINDINGS`（解档之前）：TenantBuzzBinding 与 CONTROL binding `ACTIVE`，CONTROL 私钥按钉住的 KV 版本读回并与公钥一致（与 `verify-tenant-buzz` 同一实现 `verify_control_secret`）；每个 ACTIVE TenantMembership 的 SpiceDB `tenant#member` 关系以幂等 TOUCH 收敛，再以 FullyConsistent 读回查证全部在场。
- `ROSTER`（解档之后）：relay roster 收敛到 CONTROL 加全部 ACTIVE TenantMembership 对应 Principal 的全部 ACTIVE Buzz 身份，期望集合取 `roster_reconcile::settled_relay_roster`，与对账度量同一处定义；仍在建立或撤权途中的钥匙（`unsettled_relay_roster`）留给各自的投影 Workflow。收敛后按当前事实重算并与回读比对。随后该 Tenant 每个协作面 binding ACTIVE 的 Workspace 的 Channel roster 按 DD-97 同一期望集合收敛（与 Workspace 恢复的 REBUILD 共用 `converge_channel_roster`）：`ACTIVE` Workspace 按成员事实重建，其余（暂停中、已暂停、恢复中等）只剩 CONTROL。
- 分两段的理由：relay roster 的读写都经 Community host，而已归档的 host 不解析（SF-BUZ-43），roster 对账只能在解档之后进行；不依赖 host 的 secret/binding 与 SpiceDB 在解档之前完成。
- Gateway route 与组件 scope 在 Stage 2 没有适用对象（Gateway route 与组件 binding 随 Stage 3 交付）：端点不做这两项，也不声称做了。
- 恢复 Tenant 不解档任何 Workspace 的 Channel，也不改动 Workspace 状态。
- 全部一致才 200，否则 503；前置不成立回 409。

## Workflow（`TENANT_LIFECYCLE`）

- input 的 `scope.operation`：建立链不写该字段，Worker 以字段缺省走原建立链，命令序列未变（`replay-tests` 重放通过）。
- `SUSPEND`：RUNNING → `ConvergeTenantCommunityArchive(archived=true)` → `TransitionScope(TENANT→SUSPENDED)` → COMPLETED。
- `RESTORE`：RUNNING → `ReconcileTenantRestore(BINDINGS)` → `ConvergeTenantCommunityArchive(archived=false)` → `ReconcileTenantRestore(ROSTER)` → `TransitionScope(TENANT→ACTIVE)` → COMPLETED。
- host 重新可解析的证明是解档回读的 `archived_at` 为空，且 ROSTER 段经该 host 成功读写 relay 与 Channel roster。恢复序列不调用 `VerifyTenantBuzz`：上游对任意 host 返回同一份 NIP-11 文档，它不能证明 host 由该 Community 服务；恢复所需的 binding 与 CONTROL 私钥核对已在 BINDINGS 段完成。建立链中的 `VerifyTenantBuzz` 不变。
- 失败收尾与 Workspace 同一实现（`failScope`）：`begin`、任一步骤或最终跃迁被确定拒绝时，经 Core 把 Tenant 跃迁到 `ERROR` 并写 FAILED；该次 `ERROR` 跃迁本身被拒绝只随失败一并上报，不再重试跃迁。
- 恢复在解档之后（ROSTER 段或最终跃迁）失败时，Community 已对原生端开放：先以 `ConvergeTenantCommunityArchive(archived=true)` 补偿归档并以其成功为准，再置 `ERROR`；补偿归档本身失败时仍置 `ERROR`，并把原失败与补偿失败一并上报。
- TenantBuzzBinding 为 `ACTIVE` 的 `ERROR` Tenant 可再次暂停。
- 重跑控制未开放：`task_rerun::converging_state` 对 `tenant.suspend`/`tenant.restore` 不给收敛中状态；部署引导（`tenant.bootstrap`）仍按建立链。

## 管理入口

- `GET /api/v1/platform/tenants`（契约 `api/platform_tenant_page`）：只对 Catalog 会话且在 Catalog Tenant 上 fresh `manage` 为真者开放，其余 403。列出业务 Tenant 的 id、name、slug、state，有界分页（偏移游标）；`lifecycleActionKey` 为只读提示：`ACTIVE`、以及 TenantBuzzBinding 为 `ACTIVE` 的 `ERROR` 给暂停，`SUSPENDED` 给恢复，收敛中不给；提示判定失败时记 warn，本页不给生命周期键，其余照常返回。
- Web/Desktop 共用包新增 Tenant 管理节（`react/tenants.tsx`），403 或能力未发布时不渲染；提交带显式确认（`explicitConfirmation=true` 随命令冻结），受理回应按门禁与派发状态呈现：`DISPATCHED` 显示已登记与操作号，`ABORTED` 显示原因与操作号，其余显示结果不明并保留原幂等键、只允许重查原请求。Mobile 不提供此写入口。

## 已运行的检查（2026-09-28）

| 检查 | 结果 |
|---|---|
| `SQLX_OFFLINE=true cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings` | 通过 |
| `SQLX_OFFLINE=true cargo test --manifest-path core/Cargo.toml` | 63 通过、0 失败、3 忽略；集成用例在无环境变量时跳过，含本能力的 `tests/tenant_suspension.rs` |
| Core 单元：`task_rerun::tests::identity_rerun_direction_is_fixed_by_original_action`（Tenant 暂停/恢复不作为建立链重跑）、`capability_registry::tests`（两个动作与管理视图路由已发布） | 通过 |
| `go build ./... && go vet ./... && go test ./...`（worker） | 通过；`workflows/tenant_suspension_test.go` 覆盖暂停序列、恢复序列（解档前对账、解档、roster 对账、跃迁，不调用 `VerifyTenantBuzz`）、归档被拒进入 ERROR、解档前对账被拒不解档、解档后失败先补偿归档再 ERROR、补偿归档失败仍 ERROR 且两错并报、跃迁被拒先补偿归档再只试一次 ERROR、未知 operation 当场拒绝 |
| `pnpm -r typecheck`、`pnpm -r test` | 通过；`test/tenants.test.tsx` 覆盖 403 不渲染、显式确认提交、已登记文案、结果不明重查同一幂等键、派发中止显示原因、收敛中不给动作、状态不合契约显示读取失败 |

真实环境核验以 `core/crates/kailo-core/tests/tenant_suspension.rs` 为脚本：非 Catalog 发起被拒、非 Catalog 会话读管理视图被拒、Catalog 普通成员（无 Catalog manage）发起与读取管理视图被拒、参数闭集、状态冲突、Catalog 不能暂停自己、两侧执行与 operation 分离且业务侧审计引用 Catalog 执行、不建立 Catalog Principal 的业务侧 relationship、暂停后成员 `TENANT_NOT_ACTIVE`、operator 列表 `archived_at` 非空、托管私钥按原 host 直连发布被 Relay 明确拒绝（HTTP 拒绝或 `accepted=false`；传输失败按核验失败处理）、恢复后成员可用、`archived_at` 为空、直连发布被接受、成员 tenant 关系保留。

## 真实环境核验（2026-09-28，`--fresh` 后的本地拓扑）

新 Core、Worker 与迁移 `20260928150000_tenant_suspension`、新 Web 镜像（`sha256:cb1baee20ae884dda35b2117480b66e95b769fb203ea74a457b9fcc578737919`）上，`core/verify/run-integration.sh` 全套退出 0（31 批），`tests/tenant_suspension.rs` 与 `tests/workspace_suspension.rs` 各 1/1。复核修正（归档每次重发并以上游成功为准、解档后失败先补偿归档、恢复以 operator 回读与经 host 读写 roster 证明可解析、恢复时收敛各 Workspace 的 Channel roster、从 `ERROR` 暂停要求 binding ACTIVE）之前的一轮同样全绿（31 批），两轮之间用例未放宽。

破坏核验（已还原并复验）：Worker 的 Tenant 暂停分支去掉 Community 归档步骤后重建部署，用例在「暂停后 operator 列表中该 Community 的 archived_at 应非空」失败。暂停与恢复各录制一份真实终态 history（`worker/replay-tests/testdata/component_task_tenant_suspend_history.json`、`…_restore_history.json`）并加入 `TestComponentTaskReplay`；再次去掉归档步骤时暂停 history 重放报 `TMPRL1100`，还原后通过。

部署侧：平台管理员 IdP 用户经 `bootstrap.sh --ensure-platform-admin` 无损补齐，Catalog 首位管理员经 `bootstrap-tenant` 引导并重跑幂等（见 `apps/07` §2）。

未覆盖：归档遇上游 503（断开传播未完成）后的重发收敛、恢复在解档后失败的补偿归档，只有 Core 与 Worker 单元覆盖，未在真实 Relay 注入故障；原生端已建立的 WebSocket 连接被断开这一点依赖上游 `disconnect_community_clusterwide`（SF-BUZ-43），用例以「按原 host 直连发布被拒」判定关闭，未单独观测既有连接的断开时刻；Tenant delete 与受限会话随 Stage 3。
