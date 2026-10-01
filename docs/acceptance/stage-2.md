# Stage 2 验收报告：统一治理内核、Temporal 与任务工作台

- 报告日期：2026-09-29
- 核对基线：提交 `9566ac0`（目录重构 `076681d` 之后的 release 登记）
- 依据：`02-纵向交付路线.md` §4 的验收映射与退出门禁、§1.1 端交付规则；`03-验证发布与验收门禁.md` §9
- 证据口径：只引用核验记录、追溯记录与提交说明中写明的实际执行结果；路径相对 `apps/`。核验记录中早于目录重构的测试路径仍写作 `core/crates/kailo-core/…`，现对应 `core/crates/platform-core/…`

## 结论

**不能关闭。** 八项退出门禁中七项有证据，「录制 history 在升级版本 Worker 上 replay」只以当前代码重放旧 history 证明；实施内容中「完整 SecretRef 生命周期」被核验记录明确登记为未完成（`core/verify/secret-ref.md` L269：「故不把 Stage 2 SecretRef 生命周期标记完成」），`V-SCN-69` 被明确登记为不关闭（`core/verify/secret-ref-rehome.md` L488–490）；Desktop 的取消、重试与 evidence 导航没有端到端证据，不满足 §1.1「每个端各自成立」。关闭条件见「关闭前必须补齐」。

追溯记录中 Stage 2 的七条能力记录（`governance.action_admission`、`governance.audit_evidence`、`governance.role_management`、`governance.tenant_invitation`、`identity.secret_ref_rehome`、`lifecycle.tenant_suspension`、`lifecycle.workspace_suspension`）保持 `status: in_progress`，本报告不建议变更。

## 1. 范围与未进入范围

范围：ActionDefinition/Execution、Operation、ApprovalPolicy/Projection、WorkflowRef、TaskProjection；`ApprovalWorkflow` 与 `SECRET_REF_REHOME`；Update、Validator、取消与 UNKNOWN 语义；`ProjectTaskState` 全 kind 与 WorkflowRef 有界对账；fresh 审批准入、职责分离与 consumed/invalidated；SecretRef 生命周期；Tasks、Approvals、详情、取消、重试与 evidence 导航；Tenant 与 Workspace 的暂停与恢复。

未进入范围：ExternalExecution（`EXT-BASE`）；Tenant delete 与 TenantLifecycleSnapshot（Stage 3）；`AGENT_INSTALLATION`、`AgentTaskWorkflow`、依赖 Resource owner 的审批与 owner 转移（Stage 5）；组件相关 kind（`EXT-BASE` 及能力扩展）；`RESOURCE_EXPORT`/`RESOURCE_IMPORT`（一期不注册）。`V-SCN-07` 的旧会话 bearer 部分在 Stage 5、ActionToken 部分在 `EXT-BASE`；`V-SCN-31` 的删除部分在 Stage 3。

## 2. 接缝与 GAP

本 Stage 不闭合新的上游接缝；`lifecycle.tenant_suspension` 复用 `SS-BUZ-OPERATOR`（`collaboration/fork/verify/operator-provisioning.md`）归档 Community。`GAP-IDN-01` 已由 `DD-83` 闭合（邀请签发、兑换与 admin 确认，`core/verify/tenant-invitation.md`）。`GAP-BUZ-01` 仍存在（见 Stage 1 报告）。

## 3. 设计/代码/验证/artifact 追溯

| 场景 | 追溯记录 | 验证证据 | 覆盖端 | 判定 |
|---|---|---|---|---|
| `V-SCN-07` | `governance.action_admission`、`governance.role_management`、`governance.tenant_invitation` | `core/verify/governed-action.md` L50（批准后撤权，重新准入 `PERMISSION_DENIED`、审批 INVALIDATED）、L87（跳过重新准入的破坏核验失败）；`tenant-invitation.md` L43、L78 | 后端集成 | 本 Stage 部分通过 |
| `V-SCN-31` | `lifecycle.tenant_suspension` | `core/verify/tenant-suspension.md` L76（2026-09-28，31 批退出 0，`tenant_suspension.rs` 1/1）、L78（去掉归档的破坏核验失败，暂停 history 破坏后 `TMPRL1100`） | Web、Desktop；Mobile 不提供 | 暂停与恢复通过；上游 503 后重发与补偿归档只有单元测试（L82） |
| `V-SCN-32` | `lifecycle.tenant_workspace_membership`、`governance.action_admission` | `membership-lifecycle.md` L36–59；`identity-chain.md` L159–184 | Core | 通过 |
| `V-SCN-34`、`V-SCN-35` | 同上 | `identity-chain.md` L159–184（2026-09-29，31 批，两项破坏核验）；`role-management.md` L48 | Core | 本 Stage 部分通过；owner 部分在 Stage 5 |
| `V-SCN-36` | `lifecycle.workspace_suspension` | `core/verify/scope-suspension.md` L65–69（2026-09-28，30 批退出 0，`workspace_suspension.rs` 1/1，两项破坏核验，暂停/恢复 history 破坏后 `TMPRL1100`） | Web、Desktop；Mobile 无写入口 | 通过；ERROR/ABORTED 路径与原生设备暂停期行为只有单元测试（L71） |
| `V-SCN-37` | `governance.action_admission`、`governance.role_management` | `role-management.md` L46（并发互撤恰好一份 CONSUMED、一份 INVALIDATED） | Core | 本 Stage 部分通过；Worker 单元 `TestMultiRoleRequirementsCountDistinctApprovers` 只见于提交 `c4a597f` 说明，没有核验记录 |
| `V-SCN-38` | `governance.action_admission` | `governed-action.md` L53、L89 | Core | 本 Stage 部分通过；ExternalExecution 部分在 `EXT-BASE` |
| `V-SCN-43` | `governance.audit_evidence` | `core/verify/audit.md` L70–80（2026-09-28，29 批，`audit_evidence.rs` 1/1，去掉 RESTRICTED 拦截的破坏核验失败）、L109–123（2026-09-29，31 批，走查 20/20） | Web | Web 通过；Desktop 无 EvidenceRef 走查，Mobile 不提供范围审计（L80） |
| `V-SCN-67` | `governance.tenant_invitation` | `tenant-invitation.md` L90–104（2026-09-25，1 passed，六项破坏核验）；`web-client/fork/verify/web-surface.md` L56 | Web；Desktop 不承接兑换 | 通过 |
| `V-SCN-68` | `governance.action_admission` | `governed-action.md` L99–135（2026-09-26 取消、重跑、需审批的重跑各 1 passed；Web 走查；2026-09-28 CLIENT 身份重跑） | Web | Web 通过；Desktop 未做取消/重跑端到端（L103），CLIENT 身份重跑无浏览器走查（L135） |
| `V-SCN-69` | `identity.secret_ref_rehome` | `secret-ref-rehome.md` L492–540（2026-09-28，31 批，破坏核验，replay，走查 20/20） | Web、Desktop | **未闭合**：记录 L488–490 明写真实写入响应丢失、执行中撤权、销毁响应丢失的端到端链与生产规模积压无证据，「`V-SCN-69` 和 Stage 2 不因此关闭」 |

artifact：七条 S2 记录登记 `core` `sha256:7e9b800d…`、`worker` `sha256:9e7d3a6d…`、`web-client` `sha256:b9a953fa…`，其中 `governance.role_management` 与 `identity.secret_ref_rehome` 另登记 `desktop-client` `sha256:14e4cc9c…`（提交 `9566ac0`）。

## 4. 实际执行的验证命令和结果

| 时间与出处 | 命令 | 结果 |
|---|---|---|
| `core/verify/functional-layout-regression.md`（目录重构 `076681d` 之后） | `core/verify/run-integration.sh`；`core/verify/web-walkthrough.sh`；`tools/check.sh --full`（隔离库） | 31 批全绿；走查 20/20；退出 0；派发记录的破坏核验在「登记完成后派发状态仍未推进」处失败（`left: NOT_DISPATCHED`，`right: DISPATCHED`），还原后 31 批通过 |
| `core/verify/release-artifacts.md`「2026-09-29」段；提交 `9566ac0` | `tools/release.sh`（`076681d` 的 `apps/` 树）；`tools/check.sh trace`、`seam`、`supply` | core `7e9b800d…`、worker `9e7d3a6d…`，`dist/` 下有 SBOM 与 provenance；三步通过 |
| `governed-action.md` L59–67（2026-09-24） | `sg docker -c "bash core/verify/run-integration.sh"`；`web-walkthrough.sh` | 退出 0；14/14 |
| `governed-action.md` L69 | `DRILL_CAN_HISTORY_COUNT=18 bash core/verify/drill-approval-can.sh` | 1 passed，3 个 run（continue-as-new） |
| `governed-action.md` L71–77（2026-09-26） | `go test ./replay-tests/... -count=1 -v` | 三组 PASS；改坏 Activity 名后 `TMPRL1100` |
| `worker/verify/component-task-cancel.md` L14–17 | `go test`（`TestComponentTaskCancel`） | ok |
| `core/verify/task-terminal-observation.md` L14–16 | 定向集成 | 1 passed，反向核验失败 |
| `secret-ref-rehome.md` L398–452（2026-09-28） | 定向集成 | `copy_unknown_observes_only_the_frozen_target` 1/1；对账器派发的 Temporal 恢复 1/1 |
| `desktop-client.md` L112–137（2026-09-29） | `.deb` 安装包端到端 | Tasks 列表、Approvals 批准一次 |
| `mobile-client.md` L87–124（2026-09-29） | profile APK 模拟器端到端 | 只读：审批详情无决定入口 |

## 5. migration 与 Workflow replay

- 迁移前进/回退（隔离库）：2026-09-25 `kailo_verify_terminal_index_20260925`、2026-09-26 `kailo_verify_gate_20260926_01`（20 个迁移、33 个约束）、2026-09-27 `kailo_rehome_verify_20260927`（34 个约束）与 `kailo_rehome_guard_20260927`（首次退出 1，为空库顺序问题，修正后退出 0）、2026-09-28 `kailo_verify_governance_fairness_20260928`（25 个迁移），以及重构后隔离库的 `check.sh --full`（`core/verify/functional-layout-regression.md`）。只证明空白库上的前进、回退一步与再前进（`core/verify/task-terminal-repair.md` L34）。
- Replay：`worker/replay-tests/baseline_test.go` 的 `TestBaselineReplay`、`TestComponentTaskReplay`（16 份 fixture）、`TestApprovalReplay`（8 份，含 consumed、invalidated、cancelled、expired 与 continue-as-new 三段）。`SECRET_REF_REHOME` 与 Tenant/Workspace 暂停恢复均有录制 history 与破坏核验。
- 缺口：「升级版本 Worker」只以当前代码重放旧 history 实现，没有部署升级后的 Worker 二进制重放在途 history 的记录；replay 不比对 Activity timeout/retry（`baseline_test.go` L36–41）。

## 6. 安全、故障和恢复演练

- 审批不能由 Core 直接改状态：直接把投影改成 APPROVED 的破坏核验失败（`governed-action.md` L88）；批准后派发前重新准入（L87）。
- Start 响应不明：同键重试收敛（L53），换 workflow ID 的破坏核验失败（L89）；RB-05 演练、RB-01 `drill-task-rerun.sh`。
- 投影落后：显示 `PROJECTION_DELAYED`（`governed-action.md` L54、L90；`task-terminal-observation.md`；`task-terminal-repair.md` L21、L30）；Desktop 与 Mobile 的 UI 破坏核验见 `desktop-client.md` L63–65、`mobile-client.md` L42。
- Tenant delete 不可见：`tenant.delete` 返回 `CAPABILITY_BLOCKED`，目录中无定义（`governed-action.md` L48）。
- 暂停：先 fail closed、再归档并回读，只由 Catalog scope 的 platform admin 发起，暂停中成员在身份解析即被拒，全量对账后恢复（`tenant-suspension.md` L10、L20、L33、L37–44、L72、L76；`scope-suspension.md` L17–21、L67）；Resource、relationship 与 binding 保留（`scope-suspension.md` L21）。已建立 WebSocket 的断开时刻未单独观测。
- EvidenceRef：撤销 auditor 后立即 403，不存在 404，UNVERIFIABLE 显示不可用（`audit.md` L74、L76、L111–123）。
- SecretRef 归位 UNKNOWN：`copy_unknown_observes_only_the_frozen_target` 首次目标缺失返回 503 且保持 `COPY_UNKNOWN`（`secret-ref-rehome.md` L398–430）；没有注入真实的网络响应丢失（L429、L451）。
- Runbook 演练：RB-04 Worker 回滚（2026-09-23，发布前 replay 门禁失败；发布后在途 execution 卡住但不越权；按镜像回滚后完成）；RB-02 步骤 E、F（2026-09-24、09-26）。

## 7. 性能与容量边界

没有容量实测。`07-运行与运维基线.md` 明写不给数字、要求在预发布环境取得基线；`task-terminal-repair.md` L38 明写生产规模下的积压与时延尚无实测；CapacityLease 在本 Stage 无适用对象（`governed-action.md` L81）。已知用例耗时：`governed_action` 约 105 秒，其中 62 秒为新鲜度上界等待（L59–60）；取消 116.25 秒、重跑 105.22 秒。

## 8. 已知限制及其 UI 表达

- Tenant 暂停：`TENANT_NOT_ACTIVE` 文案已进 Web 与 Mobile（`tenant-suspension.md` L24）。
- 任务页显示 reason code 与 operation（`web-surface.md` L53）；evidence 为 404 或 UNVERIFIABLE 时显示「不可用」（`audit.md` L116–117）；RESTRICTED 证据在 ResultExposure 交付前一律不可用（L80）。
- Mobile 只读：审批详情无决定入口；未交付能力深链返回 `SURFACE_CAPABILITY_UNAVAILABLE`。
- Desktop：`desktop-client.md` L70（2026-09-25）仍写「不渲染取消/重跑入口」，与 2026-09-29 的安装包记录未对齐，取消、重试、evidence 在 Desktop 上的状态没有当前证据。
- 设备登记任务曾显示「Allowed, not started yet」而设备已 ACTIVE：**已闭合**（`ccb0a36` 的 `record_dispatch` 与迁移 `20260929110000_dispatch_state_backfill`；`tests/native_client.rs` 断言 `DISPATCHED`；重构后的破坏核验与 31 批回归见 `core/verify/functional-layout-regression.md`）。修复后未在安装包上重新观察。
- SecretRef 生命周期：旧版本销毁、孤儿路径收敛、服务凭据轮换顺序与消费端投递未实现（`secret-ref.md` L268–269 等）。
- Mobile release 签名缺 upload keystore；iOS 与 macOS/Windows 安装包无构建环境。
- 失败保留的四个夹具 Tenant（`53941c2e…`、`c8652adc…`、`060e8796…`、`b5ca5ffa…`）待 Stage 3 的 `tenant.delete` 删除。
- ADR-17 的内部标识迁移尚在进行；落地后 workflow ID 前缀与 Search Attribute 改变，须重跑 replay、对账与集成。

## 9. 发布、回滚和数据保留结论

- 发布：`core` `7e9b800d…` 与 `worker` `9e7d3a6d…` 由 `tools/release.sh` 从 `076681d` 的 `apps/` 树构建，provenance 的 `gitCommit` 为 `dae9abd`（`apps/` 树与 `076681d` 相同），见 `core/verify/release-artifacts.md`「2026-09-29」段。未推送共享 registry，未签名。
- 回滚：唯一的 Worker 回滚演练是 2026-09-23 的 RB-04，没有针对 `9e7d3a6d…` 的回滚演练。
- 数据保留：暂停期间 Resource、relationship 与 roster 保留已验证；四个夹具 Tenant 保留在本地 Core 与 OpenBao 中。

## 关闭前必须补齐

1. 完整 SecretRef 生命周期：旧版本销毁、孤儿路径收敛、服务凭据轮换顺序、各消费端投递，并有演练证据。
2. `V-SCN-69`：真实写入响应丢失、执行中撤权、销毁响应丢失的端到端故障注入证据。
3. Desktop 的取消、重试与 evidence 导航端到端证据，并更新 `desktop-client.md` 中过时的「不渲染取消/重跑入口」。
4. 以升级后的 Worker 镜像重放在途 history 的记录（同版本已有）。
5. 针对 `worker 9e7d3a6d…`（及 `core 7e9b800d…`）的回滚演练记录；现有 RB-04 演练早于这两个 digest。
6. `V-SCN-37` 的多角色审批 Worker 单元测试结果写入核验记录。

以下不阻断关闭，但须在一期收口前解决：Mobile release 签名、iOS 与 macOS/Windows 安装包、四个夹具 Tenant 的删除、ADR-17 迁移后的重验、容量基线、重构后安装包端到端的复跑。
