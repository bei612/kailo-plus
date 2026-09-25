# 角色管理与部署引导的核验

对应 Stage 2 治理内核（`02-纵向交付路线.md` §4）中让审批链在产品里可用的三件事：
真实用户能成为 Tenant/Workspace admin、Tenant 永不失去最后一位 admin、第一位 admin
有一条可审计的来路。

权威：`DD-82`（角色）、`.design/03` §5 的固定 schema 与 RoleTemplate
规则、`.design/09` §5（provisioning fact）、`.design/10` §4 §5（撤权收敛）、ADR-11（引导形态
与 Core 写关系）。

## 设计取舍（`.design` 已定的不在此重述）

| 问题 | 结论 | 依据 |
|---|---|---|
| 角色事实存在哪里 | 只在 SpiceDB。Core 不建角色分配表，只存授予/撤销的 ActionExecution、ActionDecision 与审计；RoleTemplate 以 Catalog 版本展开（`TENANT_ADMIN`→`tenant#admin`、`WORKSPACE_ADMIN`→`workspace#admin`） | `.design/03` §5「不是第二套 assignment 表」、DD-82 |
| 一期登记哪些角色 | Tenant admin 与 Workspace admin。`approver` 只在 resource/asset 上，一期没有 Resource，`RESOURCE_APPROVER` 选择器仍以 `APPROVAL_SELECTOR_UNRESOLVABLE` 拒绝；`creator`/`auditor` 没有一期消费者，不登记 | `.design/03` §5 固定 schema |
| 执行方式 | SYNC：一次 SpiceDB 写，不包装 Workflow；仍建 ActionExecution——它有审批、可重试外部副作用与 UNKNOWN | DD-09、`.design/03` §4 |
| 谁需要审批 | 撤 Tenant admin 需另一位 Tenant admin 批准（`self_approval=DENY`），与撤 Tenant 成员同级；授予不需要——只有一位 admin 的 Tenant 否则加不出第二位 | 迁移 `20260925100000` 的策略注释 |
| 「最后一位 admin」的串行点 | `identity.tenant` 行锁。撤 admin、授 admin、撤 TenantMembership 的落定与派发都在锁内判定并完成写入；准入时先判一次给出早拒绝，授权之后才判（无权者得到 `PERMISSION_DENIED` 而不是探出谁是最后一位） | DD-82、ADR-11 |
| 有效 admin | 持有 `tenant#admin` 且 TenantMembership `ACTIVE` 的 active HUMAN；`REVOKING` 不计 | DD-82、DD-45 |
| 并发的同一角色动作 | target 取（对象、角色、Principal）的 UUIDv5，待决唯一索引让同一角色的并发准入先后排队 | `roles::target_id` |
| 派发结果不明 | 记 UNKNOWN，对账以同一意图重发（TOUCH/DELETE 幂等）；重发时授予对象已失去成员资格就先删关系再记 ABORTED，只收紧 | `.design/09` §4 |
| 已批准动作在派发时不再成立 | 记 `ALLOWED/ABORTED` 与原因，并发 invalidate，批准不会被消费 | `.design/06` §4 |
| Tenant 撤权撤什么 | 该 Principal 在本 Tenant 与任何 Workspace 上的全部关系（按主体过滤删除，不依赖 Worker 知道角色清单），查证一条不剩后才 `REVOKED` | `.design/10` §5、DD-82 |
| 与成员事实不一致的角色关系 | `role_reconcile` 以 Core 成员事实为准删除（非成员、已撤权、跨 Tenant、非 HUMAN），留 RECONCILIATION 审计；并度量 `kailo.tenant.without_effective_admin` | DD-82 |
| 第一位 admin | 部署引导：Core 容器内的一次性子命令，只做 0→1，见 ADR-11 | DD-82、`.design/09` §5 |

## Tenant 成员邀请

成员邀请曾受 `GAP-IDN-01` 阻断，现由 `DD-83` 闭合，核验见
[tenant-invitation.md](tenant-invitation.md)。本文件的夹具成员（B、C、D）仍由夹具直接
开通：它们只是角色动作的对象，不经邀请以免两份核验互相牵连。

## 用例与断言面

`core/crates/kailo-core/tests/role_management.rs`（端到端，真实拓扑）：

| 场景 | 断言（取自 SpiceDB 或 Core 库，不以 BFF 回应为据） |
|---|---|
| 部署引导 | Tenant 经 `TENANT_LIFECYCLE`、首位成员经 `MEMBERSHIP_PROJECTION` 开通；zed 读到 `tenant#admin`；三步各有 DISPATCH 审计、admin 有 `ROLE_GRANTED` 的 OUTCOME；全部 ActionExecution 的发起方是部署引导 ServicePrincipal |
| 引导重跑 | 同一人 → `COMPLETED`、不追加；另一人 → 退出码 4 `INERT`，没有成员关系、没有登记外部身份 |
| 最后一位 admin | 撤自己的 admin、撤自己的成员关系 → 422 `LAST_TENANT_ADMIN`，门禁 `DENIED`，关系仍在 |
| 授予 | 200、`DISPATCHED`、无 workflow；zed 可见；DISPATCH/OUTCOME 审计与 ZedToken；重复授予 409；非 admin 403；非成员 422 |
| 并发授予同一角色 | 恰好一个 200、一个 409，关系一条 |
| 撤 admin 的审批 | WAITING 期间关系仍在；另一位 admin 批准 → RECHECK → SYNC 派发 → `CONSUMED`，关系消失 |
| 并发互撤（只有 A、B 两位 admin，A 撤 B 与 B 撤 A 同时获批） | 恰好一份 `CONSUMED`、一份 `INVALIDATED`；恰好留下一位 admin；落败一方在重新准入（`PERMISSION_DENIED`/`LAST_TENANT_ADMIN`）或派发时（`ABORTED`/`LAST_TENANT_ADMIN`）被拒 |
| Workspace admin | 授予前非成员管理 Workspace 被拒；授予后可加成员；撤销后再管理被拒 |
| Tenant 撤权撤全部关系 | 被撤者的 `tenant#admin`、`tenant#member`、`workspace#admin` 全部不在 |
| 角色对账 | 旁路写入失权者的 `tenant#admin` → 三个对账周期内被删，留 `RECONCILIATION`/`ROLE_REMOVED` 审计 |
| 成员建立只有邀请一条入口 | `tenant.member.add` → 403 `CAPABILITY_BLOCKED`（`DD-83`；邀请本身的断言在 `tenant_invitation.rs`） |
| 角色管理候选人与管理范围 | BFF 的 `/api/v1/role-members` 只向 Tenant/Workspace 管理者列出本 Tenant 的 ACTIVE HUMAN 成员；未加入频道的 Tenant 成员仍可作为 Workspace 角色对象；最后一位有效 Tenant admin 的撤销按钮不可用，最终写路径仍重新准入 |
| 可管理 Workspace 选择 | `/api/v1/role-workspaces` 从本 Tenant 有界分页，逐个经 SpiceDB 的 fully-consistent `CheckBulkPermissions` 过滤；非频道成员但持有 Workspace 管理权者能选择该 Workspace；无权对象不进入结果 |

`worker/replay-tests` 纳入走新撤权路径（`tenant-revocation-all-relations`）的录制 history；
门禁之前录制的两份撤权 history 仍走旧路径。

## 怎么跑

- 端到端：`sg docker -c "bash core/verify/run-integration.sh"`（`role_management` 约 45 秒）。
- 部署引导（运维）：`docker compose --env-file .env -f compose.yaml exec -T core-bff kailo-core
  bootstrap-tenant --slug … --name … --admin-subject … --admin-display-name … --wait-seconds …`
  （ADR-11）。

## 破坏核验（每条都重建 Core 或 Worker 后实际跑过，均已还原）

| 破坏 | 结果 |
|---|---|
| 「会清空有效 admin」判定恒为假 | 撤最后一位 admin 得到 202 WAITING，断言 422 失败 |
| 引导去掉 0→1 判定 | 另一人的引导得到 `COMPLETED`（第二位 admin 被写入），断言 `INERT` 失败 |
| 角色对账不删任何关系 | 「对账没有删除失权者的 admin 关系」超时失败 |
| Tenant 撤权只走旧的 member 一步（Worker） | 「撤权后 tenant#admin 仍在」失败 |
| 去掉撤权新路径的 GetVersion 门控 | 录制的 `component_task_revocation_history.json` 报 `TMPRL1100` |

## 实测结果（2026-09-24）

- `run-integration.sh` 退出 0：`role_management` 1 passed（46.3 秒），`governed_action`
  1 passed，其余全部通过；`go test ./...` 全过。
- `web-walkthrough.sh` 14/14。
- 部署引导实跑：`{"state":"COMPLETED"}` 退出 0；重跑同一人 0；另一人 4。

## 角色管理界面与 BFF 增量核验（2026-09-25）

- Core 由 `deploy/local/start-core.sh` 重建并重启；受 cgroup CPU/内存限制的 release 构建退出 0。
- 真实拓扑执行 `cargo test -p kailo-core --test role_management -- --nocapture`：1 passed，
  0 failed，耗时 90.86 秒；新增断言覆盖管理范围、候选成员、最后 admin 标志与角色按钮。
- 共用 Web/Desktop TypeScript 平台包执行 `pnpm --filter @kailo/platform test`：49 passed，
  0 failed；异常形状的 200 响应显示读取失败，403 不展示管理区，动作仍经 BFF。
- 破坏验证：把异常响应错误提示故意改成“本页无成员”，该用例当场失败
  （1 failed、48 passed）；恢复后上述 49 项全绿。
- Web 镜像已按新补丁与共用包重建、登记 digest 并部署；真实浏览器走查 17 步通过，
  其中成员页实际载入了角色区、既有 admin 标记与授予入口。
- 首次 Desktop `.deb` 构建在 Rust 编译阶段因宿主磁盘余量降至 9.1 GiB 而主动取消；
  打包 Dockerfile 随后将编译 `target` 移到 BuildKit cache mount、只把 `.deb` 复制到最终阶段。
  再次受限构建成功，`dist/buzz-desktop/Buzz_0.5.23_amd64.deb` 的实际 SHA-256 为
  `c2349b05821540e12441b08d4e5a27bd449162efee4cc69e6f6b343905ee9b75`。

## 已知边界

- 引导需要部署者进入 Core 容器；平台内没有 Tenant 创建入口（`.design` 未定义发起方）。
- 引导只建首位成员；其余成员经邀请（`DD-83`）加入，「另一位 admin 批准」所需的第二个
  人由此而来。
- `role_reconcile` 每轮读出全部角色关系：量级与角色数成正比，一期可接受；超出时按
  Tenant 分片读取。
