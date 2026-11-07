# Stage 2 验收报告：统一治理内核、Temporal 与任务工作台

- 历史报告日期：2026-09-30
- 最新事实核对日期：2026-10-02 11:30 UTC（源码、产物、检查与运行版本核对，不是新增业务验收）
- 历史核对基线：历史发布登记包括 `9566ac0` 与其后的 `a7df56f4`；当时接手复核为 `0ec5e552` 之后的未提交工作树，历史登记不混作当时发布产物
- 依据：`02-纵向交付路线.md` §4 的验收映射与退出门禁、§1.1 端交付规则；`03-验证发布与验收门禁.md` §9
- 证据口径：只引用核验记录、追溯记录与提交说明中写明的实际执行结果；路径相对 `apps/`。核验记录中早于目录重构的测试路径仍写作 `core/crates/kailo-core/…`，现对应 `core/crates/platform-core/…`

## 2026-10-02 现状摘要

**Stage 2 仍不能关闭。** 下文 09-30/10-01 的 PASS、FAIL、命令和范围保持
历史条件，不自动成为当前版本的验收结果；旧的「当前」均指各段记录时点。

- HEAD 与实际远端 main 均为 `8ec78ed43e4a3e1fdc3f3243719cb7c1673eded6`。
  Web `ad82d6e6…` 已运行且 healthy；Core `03c24669…`、Worker `4832ccbb…`
  仍是旧运行镜像、均无 healthcheck，不覆盖新治理资格与投影修正。
- 治理、任务/审批、平台私钥退役与孤儿收敛已有实现及限定历史证据；共享
  ApprovalPanel 的刷新与 UNKNOWN 修正不是未开发项。Desktop 已直接消费
  共享 TasksPage，取消/重跑按服务端 ActionKey 呈现，不能笼统写成不渲染入口；
  这不改变 CLIENT 身份限制，也不证明当前安装包的取消、重试或 evidence 导航。
  Win11 `9aef4725…` 已是真实 unsigned 测试安装包，但尚无 Win11 运行验收，
  详见[Desktop 核验](../../collaboration/fork/verify/desktop-client.md)本日记录。
- 原关闭条件仍要求适用生产路径的私钥退休/fence 与故障证据、当前 Desktop
  管理动作验收、升级 Worker 的在途 history replay 和对应发布 digest 回滚。
  `V-SCN-69` 旧形态是否适用按真实 locator 判定，不制造旧数据；历史五项 FAIL
  不改为 PASS，也不因已写修复代码就宣称当前版本链路验收。旧回滚登记摘要
  不是当前运行或待发布版本；未有消费方的组件凭据链不预建为关闭前提。
- 含 Tenant ACTIVE 与 OpenMeter 412 修正的 `254e071f…` 候选已实际运行原
  `--full`，退出 0，但 DATABASE_URL 实际迁移演练与 `.env` 部署预检均
  SKIP，Mobile release 签名仍阻断。此前 Core 开发候选 `87c086a2…` 来自
  `77d02501…`，构建退出 0、未部署，不覆盖两处修正；本次 full 也不包含
  在开发的 AgentVersion 或独立 CHECK，不能外推整个未提交工作树通过。
  原日志为 `/volumes/data/kailo/tmp/codex-core-functional-closure-254e-full-20261002.37trEJ.log`。
  这些结果不替代本 Stage 的业务验收；AgentVersion 尚在 Stage 5 实现，不提高
  Stage 1/2 闭合状态，也不作为本 Stage 新增关闭条件。

## 历史结论与验证记录

2026-10-01 04:52 UTC 追加发布事实核对：本批新 Web、AgentGateway 镜像已入
本地 registry，Linux Desktop 安装包字节摘要已核对；当时 Web/Gateway 运行容器
仍使用旧 digest，新 Desktop 未安装验收。新产物基于完整未提交工作树，
不覆盖本报告的历史 Core/Worker provenance、业务 PASS/FAIL 或当前运行镜像。
核对时 HEAD 与本地 `origin/main` 同为 `ee4c7968…`，本轮尚无新源码提交；
registry push 不是 Git push、部署或验收。完整摘要及追溯登记错配见
`core/verify/release-artifacts.md`「二开产物登记与当前运行边界」。本 Stage 仍不能关闭。

2026-10-01 独立源码复核曾确认未来 `deletion_time` 被误判为第一段撤钥完成；
该次复核时尚未修复，历史生命周期 PASS 不覆盖此输入条件。后续修正与真实运行
见下节及 `core/verify/secret-ref.md`「同一修正的真实 OpenBao 与成员撤权闭环」。

### 2026-10-01 当时交付与适用性（历史记录）

当前 Core 镜像 `sha256:69aaf4a2762431246aa311da210e0efe1bf494966aa8d2a748bcf90258ef1e44`
已在真实产品生命周期中完成 HUMAN 撤权正向链：邀请与角色授予后，由另一管理员
提交成员撤权并由原成员经 Temporal 批准。未来删除时间版本在批准前仍 GET 200；
之后原生 delete/destroy 各有匹配的 OpenBao audit request/response，数据 GET 404、
版本 1 destroyed=true，binding、SecretRef 与成员均 REVOKED，意图退休关联本次
operation。Workflow 为 TERMINAL、TaskProjection 为 COMPLETED 且没有 observation
gap，原成员会话 403、独立管理员会话 200。事实及原成功/失败日志均见
`core/verify/secret-ref.md`「同一修正的真实 OpenBao 与成员撤权闭环」。
这不是 CONTROL/OPERATOR 全链、传输中断、500、坏 JSON 或权限拒绝的运行验收。

共用 ApprovalPanel 的刷新清除旧确认、UNKNOWN 不接受相反新决定两处修正，已构建为
Web `sha256:970e17432d5292a22dcc921069b67829e6b2900dfa20e8f555eaa0ffcde588e0`，
工具自动登记 source digest
`sha256:00d158994f8af0029930b762fc4c2f9a8f2043eab58722a7aefbf3f08adb62ed`。
限定仅部署 buzz-web 后实际 healthy，持久 `deploy/local/compose.yaml` pin 已同步；
Core、Keycloak、Relay、Worker、Gateway 未重启。真实 BOOTSTRAP_USER 经 Keycloak
登录、浏览器加载本批 PlatformApp bundle，Tasks/Approvals 都是 HTTP 200、0 条目。
镜像内 typecheck 退出 0、原平台测试 7 files/88 passed；其中原治理测试 14 项
不直接覆盖两处修复。当前真实用户范围无适用审批对象，因此两处业务场景不记 PASS，
也不制造对象或注入 UNKNOWN 来替代验收。Desktop 未构建或部署这次修正。
构建报告 3 项 npm 漏洞（2 moderate、1 high），没有自动修复或漏洞验收结论。
详见 `core/verify/task-view-enum-fail-closed.md` 本日记录。

本日归位适用性只读查询时为 4 个 ACTIVE SERVER binding、0 个遗留 locator、
0 条归位记录。此前真实集成 1 passed/5 failed 保留原日志，五项依赖的旧形态在当前
全新环境没有真实适用对象；第六项代理检查未重跑。没有补写旧 locator、OPEN/BOUND
意图或放宽断言来制造验收。详见 `core/verify/secret-ref-rehome.md`「接手失败日志与
现有核验数据形态复核」；这些计数不验证复制、切换或持久 fence 的实际运行。

上述局部闭环不关闭 Stage 2，不提高能力注册表状态。Registry push、实际部署、
持久 Compose pin 与 Git push/clean commit provenance 是不同事实；本次新产物
仍以实际工作树摘要为来源，不覆盖前文历史发布登记或整个一期发布证明。

### 2026-09-30 业务验收记录（原条件保留）

以下保留当日业务证据及其限制，不以本轮新构建替代原执行条件。

当前验收范围按 2026-09-30 用户确认：全新 Compose 开发环境、全新数据库，无线上旧版
或历史数据保留要求。旧 writer 兼容与迁移前历史形态恢复无适用对象，不再作为当前
开发或发布阻断；数据库基线见 `06-工程基线规范.md` §5。下文历史执行记录保持原
条件范围，不把历史数据恢复任务加入当前 Stage 关闭条件。

修正后的全新初始化已实际退出 0，且当前真实 Web transport 为 11/11；二者不覆盖
SecretRef 归位组的全部运行验收。上一轮真实集成的五项归位失败仍按原日志保留，
不因开发环境重建记为通过；见 `functional-layout-regression.md` 的最新执行记录。

后续本批只修复共享主题、协作界面时间与连接文案，Web `a830bba5…` 已部署、主题
真实走查 5/5，Desktop `b90bd372…` 构建通过、未安装验收。追溯只同步实际摘要，
不提高七条能力状态，不据此关闭上述五项归位失败或本 Stage。

**不能关闭。** 平台自持私钥退役、孤儿收敛与归位回应丢失/撤权已有真实拓扑通过结果，不能再笼统写成「未实现、无真实证据」。独立复核确认存量 BACKFILLED/BOUND 旧意图的归位退休事务缺陷：destroy 后写 `retired_at` 却没有退休 operation，违反新 CHECK；详情见 `secret-ref-rehome.md`「独立复核」。旧 ref 退休归属冻结与历史来源判别已写入源码，但尚无本修复的运行证明。二次复核另确认归位目标切换与销毁可交错，对应写前意图和持久 fence 共享链修复也已写入源码，尚未取得运行验收，不能把源码修复解释为归位整体安全。后续当前产物匹配后的全量门禁退出 0，四侧生成与 Web/Desktop 来源摘要匹配已通过；保留前轮退出 1 的记录。该门禁不覆盖独立复核发现的旧 Core 写入兼容及 operator 退役失败重驱动缺陷，详见 `functional-layout-regression.md`「当前产物匹配后的全量门禁与独立复核」。四语言基础测试未启用真实服务集成开关。本增量的破坏核验与发布产物尚未收口；录制 history 在升级 Worker 镜像上的 replay、当前 digest 的回滚、Desktop 取消/重试/evidence 的安装包证据仍缺。未接入消费端的组件凭据轮换与投递不计作已经交付的生命周期。关闭条件见「关闭前必须补齐」。

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
| `V-SCN-37` | `governance.action_admission`、`governance.role_management` | `role-management.md` L46（并发互撤恰好一份 CONSUMED、一份 INVALIDATED）；「接手复验：多角色审批计数」记录已有 Worker 单元 1/1（2026-09-30） | Core；Worker SDK 单元环境 | 本 Stage 部分通过；已有单元结果现已实际复跑并记录，不扩充为生产角色与 Resource owner 全场景验收 |
| `V-SCN-38` | `governance.action_admission` | `governed-action.md` L53、L89 | Core | 本 Stage 部分通过；ExternalExecution 部分在 `EXT-BASE` |
| `V-SCN-43` | `governance.audit_evidence` | `core/verify/audit.md` L70–80（2026-09-28，29 批，`audit_evidence.rs` 1/1，去掉 RESTRICTED 拦截的破坏核验失败）、L109–123（2026-09-29，31 批，走查 20/20） | Web | Web 通过；Desktop 无 EvidenceRef 走查，Mobile 不提供范围审计（L80） |
| `V-SCN-67` | `governance.tenant_invitation` | `tenant-invitation.md` L90–104（2026-09-25，1 passed，六项破坏核验）；`web-client/fork/verify/web-surface.md` L56 | Web；Desktop 不承接兑换 | 通过 |
| `V-SCN-68` | `governance.action_admission` | `governed-action.md` L99–135 的历史取消/重跑走查；`task-view-enum-fail-closed.md` 本日新 Web 与真实空列表 | Web | 历史 Web 范围通过；本批两处审批修正无真实适用对象，原 14 项治理测试不直接覆盖，不新增 PASS；Desktop/CLIENT 重跑限制保留 |
| `V-SCN-69` | `identity.secret_ref_rehome` | `secret-ref-rehome.md` 的历史 6/6、后续 1 passed/5 failed 及本日适用性查询 | Core/OpenBao；历史 Web/Desktop 证据见原记录 | 历史结果不互相覆盖；查询时 0 遗留 locator、0 归位记录，无当前真实适用对象，不制造旧数据，亦不把五项 FAIL 改为 PASS。复制/切换与持久 fence 本增量未运行验收 |
| `V-SCN-86` | 场景尚未登记到追溯 YAML | `secret-ref.md` 与 `native-identity.md` 历史 7/7；`secret-ref.md` 本日真实 HUMAN 审批撤权及 delete/destroy audit | Core/Relay/OpenBao | 未来删除时间 HUMAN 正向链当前已通过，CONTROL/OPERATOR 与故障覆盖不由该结果扩大；完整破坏核验与发布登记未完成 |

历史 artifact：提交 `9566ac0` 时，七条 S2 记录登记 `core` `sha256:7e9b800d…`、`worker` `sha256:9e7d3a6d…`、`web-client` `sha256:b9a953fa…`，其中 `governance.role_management` 与 `identity.secret_ref_rehome` 另登记 `desktop-client` `sha256:14e4cc9c…`。

以上为 `9566ac0` 的历史发布登记。2026-09-30 首轮把 13 份追溯记录中的 Web
摘要同步为来源记录的 `sha256:3159cff1…`，两处 Desktop 摘要同步为该轮实存安装包的
`sha256:e2720d13…`；没有提高状态或以旧安装包证据替代新包验收。本地 Core
重建没有新发布 provenance，不能从 YAML 校验通过推出当前整批已发布。

随后提交 `a7df56f4` 已登记 Core `sha256:a52669b…`、Worker `sha256:8a05f23…`。
现存对应 SBOM/provenance 的只读补核见 `release-artifacts.md`「ADR-17 后的历史发布登记」：
两份 provenance 的源提交均为 `b592e353…`。这解释当前追溯 YAML 中的历史服务端摘要，
不把它们算作本次未提交增量或恢复镜像的发布证明；本次未重新构建或运行发布门禁。

## 4. 实际执行的验证命令和结果

| 时间与出处 | 命令 | 结果 |
|---|---|---|
| `core/verify/secret-ref.md`「同一修正的真实 OpenBao 与成员撤权闭环」（2026-10-01） | 现有 Compose 产品引导与真实原生 PKCE/BFF/Temporal 审批入口；只读 audit 与终态查询 | 成功命令退出 0；HUMAN 原生 delete/destroy、确定退休、旧成员 403、独立管理员 200。准备命令的两次失败保留；未运行其他故障分支或关闭 Stage |
| `core/verify/task-view-enum-fail-closed.md`「实际 Web 产物、限定部署与浏览器结果」（2026-10-01） | 镜像内 pnpm 原检查；`tools/build-upstream.sh web-client`；原 Compose 仅 buzz-web 部署；现有浏览器 CLI | 原平台 88 passed、构建及部署退出 0；实际新 Web 登录、Tasks/Approvals 200/0 条。首轮导出缺输入测试失败保留；原 14 项不覆盖两处修复，真实两场景无适用对象，npm 3 项漏洞保留 |
| `core/verify/functional-layout-regression.md`「全新环境与消息线程用户状态收口」（2026-09-30）；日志 `codex-thread-final-full-rustpath-20260930.log` | `./tools/check.sh --full`（受限 cgroup、专用演练库） | 退出 0，全部通过；演练库清理计数 0。未启用真实服务集成，不关闭归位五项历史失败、当前发布或本 Stage；包装失败与摘要修正均保留实际记录 |
| `core/verify/functional-layout-regression.md`「退休续做、媒体漂移准入与用户状态读取的源码修正」（2026-09-30）；新本机 Core 镜像 `47e18731…` | 现有 `core/verify/run-integration.sh`，仅运行一次 | 退出 1、6 分 3.364 秒；Rust 22 批累计 79 passed、5 failed、3 ignored。归位组 5/6 失败，出现 503、COPY_UNKNOWN 或 COPIED 未收敛；后续私钥、Web transport 和 Go 未执行。清理本轮 10 个无引用 namespace，保留 5 个有 Core 引用的失败对象与 ledger；Core 恢复后独立 HTTP 200。失败原因未确认，不以历史通过结果覆盖本次失败，不关闭 Stage。 |
| `core/verify/functional-layout-regression.md`「当前产物匹配后的全量门禁与独立复核」（2026-09-30）；日志 `/volumes/data/kailo/tmp/codex-cas-stream-full-20260930.log` | `./tools/check.sh --full`（受限 cgroup、独立一次性 Postgres） | 退出 0、3 分 18.804 秒，十项实际运行；四侧生成、90 schema 兼容及当前 Web/Desktop 来源摘要匹配通过。未启用真实服务集成；不证明旧 Core 写入兼容或 operator 退役失败重驱动。Mobile release 签名仍阻断 |
| `web-client/fork/verify/web-surface.md`「CAS 与订阅修复后的当前镜像复验」（2026-09-30） | `core/verify/web-walkthrough.sh`；Web 当前 digest `9f5e4b48…` | 退出 0、20 个计时场景通过；任务取消、独立审批后重跑、审批冲突与注销终态在当前本地 Core/Web 上成立；临时 Tenant 与 namespace 清理、服务恢复通过。当前 Core 仍未提交，不关闭私钥归位并发修复、暂停恢复专门场景或发布门禁 |
| `web-client/fork/verify/web-surface.md`「完整源码树上的接手浏览器复验」（2026-09-30） | `core/verify/web-walkthrough.sh`（当前 Web 镜像） | 退出 0，20 个计时场景通过，含审批撤回/批准、取消、独立审批后重跑、任务与审批界面；原会话 REVOKED，撤回 CANCELLED，批准 CONSUMED，退出清理及服务恢复通过。仅证明该 Web 走查，不替代当前 Desktop 包 |
| `core/verify/role-management.md`「接手复验：多角色审批计数」（2026-09-30） | `go test ./workflows -run '^TestMultiRoleRequirementsCountDistinctApprovers$' -count=1 -v` | Worker SDK 单元环境 1/1，0.042 秒；复用已有用例，不作为生产角色/owner 全场景验收 |
| `core/verify/functional-layout-regression.md`「接手全量门禁复核」（2026-09-30） | `tools/check.sh --full`（独立一次性 Postgres） | 首次退出 1，失败是 Web/Desktop 构建摘要与能力追溯登记不同步；其他门禁通过。修正摘要不等于关闭本 Stage |
| 同上，摘要同步后的两次复跑 | `tools/check.sh --full`（独立一次性 Postgres） | 第二次退出 1：预检继承包装层导出的 `PLATFORM_ADMIN_USER`，缺字段检查未拒绝；隔离该配置继承后第三次退出 0，十项全部实际运行，含 35 个命名约束与 14 条追溯。检查的父环境继承限制仍记录，不据此关闭本 Stage |
| `core/verify/functional-layout-regression.md`「源码纠偏后的全量门禁」（2026-09-30）；完整日志 `/volumes/data/kailo/tmp/codex-source-corrections-full-20260930.log` | 在 `/volumes/kailo/apps` 执行 `./tools/check.sh --full`（受限 cgroup、新建隔离 Postgres；`PLATFORM_INTEGRATION` 未启用） | 6 分 30.968 秒，退出 1。1/10 含 Core Clippy、2/10 四语言基础测试、4/10 迁移及 sqlx/35 约束、5/6/7/9/10 通过；3/10 四侧生成被共享 npm 缓存 EACCES/EEXIST 阻断，90 schema 兼容检查通过；8/10 当前 Web/Desktop 源码 digest 与产物不一致。Mobile release 签名仍阻断；不替代本修复真实服务运行、负向核验或发布证明 |
| `secret-ref.md`、`secret-ref-rehome.md`、`native-identity.md` 的 2026-09-30 接手复验（未提交工作树） | `core/verify/run-integration.sh`；`tools/check.sh verify`；`tools/check-docs.sh` | 真实集成退出 0，私钥 7/7、归位 6/6、Web transport 11/11；35 个本轮 namespace 清理且前后集合相等；Core 恢复后独立 HTTP 200；四语言基础检查退出 0，文档 0 issues。发布、安装包与本增量破坏核验没有随本命令完成 |
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
- SecretRef 归位 UNKNOWN：目标缺失返回 503 且保持 `COPY_UNKNOWN`；2026-09-30 真实服务回归已通过丢弃 OpenBao 写入/销毁回应与执行中撤权用例（`secret-ref-rehome.md`「接手真实拓扑复验」）。回应丢失请求由测试进程发起，Core 后续只按 locator/metadata 收敛，不把它说成 Core 网络链的全路径故障注入。
- Runbook 演练：RB-04 Worker 回滚（2026-09-23，发布前 replay 门禁失败；发布后在途 execution 卡住但不越权；按镜像回滚后完成）；RB-02 步骤 E、F（2026-09-24、09-26）。

## 7. 性能与容量边界

没有容量实测。`07-运行与运维基线.md` 明写不给数字、要求在预发布环境取得基线；`task-terminal-repair.md` L38 明写生产规模下的积压与时延尚无实测；CapacityLease 在本 Stage 无适用对象（`governed-action.md` L81）。已知用例耗时：`governed_action` 约 105 秒，其中 62 秒为新鲜度上界等待（L59–60）；取消 116.25 秒、重跑 105.22 秒。

## 8. 已知限制及其 UI 表达

- Tenant 暂停：`TENANT_NOT_ACTIVE` 文案已进 Web 与 Mobile（`tenant-suspension.md` L24）。
- 任务页显示 reason code 与 operation（`web-surface.md` L53）；evidence 为 404 或 UNVERIFIABLE 时显示「不可用」（`audit.md` L116–117）；RESTRICTED 证据在 ResultExposure 交付前一律不可用（L80）。
- Mobile 只读：审批详情无决定入口；未交付能力深链返回 `SURFACE_CAPABILITY_UNAVAILABLE`。
- Desktop：`desktop-client.md` L70（2026-09-25）仍写「不渲染取消/重跑入口」，与 2026-09-29 的安装包记录未对齐，取消、重试、evidence 在 Desktop 上的状态没有当前证据。
- 设备登记任务曾显示「Allowed, not started yet」而设备已 ACTIVE：**已闭合**（`ccb0a36` 的 `record_dispatch` 与迁移 `20260929110000_dispatch_state_backfill`；`tests/native_client.rs` 断言 `DISPATCHED`；重构后的破坏核验与 31 批回归见 `core/verify/functional-layout-regression.md`）。修复后未在安装包上重新观察。
- SecretRef 生命周期：本日未来删除时间 HUMAN 审批撤权正向链已在当前 Core 上运行；归位适用性查询为 0 遗留 locator、0 条归位记录，历史五项 FAIL 保留但不要求制造旧形态。复制/切换与持久 fence 的本增量运行、其他退役消费者故障覆盖和完整发布证据仍未闭合。未接入消费端的服务凭据/数据密钥轮换与投递不计为已交付（`secret-ref.md`、`secret-ref-rehome.md`）。
- Mobile release 签名缺 upload keystore；iOS 与 macOS/Windows 安装包无构建环境。
- 历史失败保留的四个测试 Tenant（`53941c2e…`、`c8652adc…`、`060e8796…`、`b5ca5ffa…`）已随获准的全新开发环境重建删除，不再交给 Stage 3 清理；原始失败日志保留，不充作当前数据现场。
- ADR-17 的本地迁移与重验已有 `core/verify/neutral-identifiers-migration.md` 记录；新旧 Workflow ID/SA 的一次性兼容窗口仍按 ADR 的退出条件关闭，不把 replay 通过解释为窗口已关闭。

## 9. 发布、回滚和数据保留结论

- 发布：当前追溯 YAML 的历史服务端登记为 Core `a52669b…`、Worker `8a05f23…`，提交 `a7df56f4` 记录构建及登记；现存 provenance 的源提交均为 `b592e353…`，见 `core/verify/release-artifacts.md`「ADR-17 后的历史发布登记」。旧 `9566ac0` 的产物证据保留在前一节。这些历史产物不覆盖本次未提交增量，未推送共享 registry，未签名。
- 回滚：现有 Worker 回滚演练是 2026-09-23 的 RB-04；本报告所引记录未提供针对当前追溯登记 `8a05f23…` 的回滚演练。
- 数据保留：暂停期间 Resource、relationship 与 roster 的产品保留规则及历史验证不变；本次开发环境另经用户授权重建，四个历史测试 Tenant 已删除。

## 关闭前必须补齐

1. 平台自持私钥生命周期：已有正向真实服务证据；补齐 `DD-113/115` 本增量破坏核验、`V-SCN-86` 追溯与发布产物登记。组件凭据投递仍按其首个真实消费端所属范围交付，不预建无调用方的链路。
2. `V-SCN-69` 按真实遗留 locator 判定适用性，本次查询为无适用对象；旧数据库形态恢复不在当前范围，不把新生命周期的独立 locator 改写成旧形态来运行归位。历史 FAIL 与代理发起边界保留，不写成新 PASS；当前确实适用的私钥退休与持久 fence 消费链仍须对应其生产路径取得证据。
3. Desktop 的取消、重试与 evidence 导航端到端证据，并更新 `desktop-client.md` 中过时的「不渲染取消/重跑入口」。
4. 以升级后的 Worker 镜像重放在途 history 的记录（同版本已有）。
5. 针对当前追溯登记 `worker 8a05f23…`（及 `core a52669b…`）的回滚演练记录；现有 RB-04 演练早于这两个 digest。

`V-SCN-37` 的已有多角色审批 Worker 单元结果已实际复跑并写入
`core/verify/role-management.md`（2026-09-30），不再列为缺失记录。

以下不阻断关闭，但须在一期收口前解决：Mobile release 签名、iOS 与 macOS/Windows 安装包、ADR-17 兼容窗口退出及对应重验、容量基线、重构后安装包端到端的复跑。
