# Tenant 成员邀请的核验

对应 `DD-83`（`GAP-IDN-01` 闭合）与 `V-SCN-67`：一个 Tenant 在产品里拥有第二个、第三个人。

链路：Tenant admin 以语义命令 `tenant.member.invite` 签发 → 回应里一次性给出链接（凭据在
URL fragment）→ 被邀请人经 OIDC 登录后打开链接，Web 端把 fragment 里的凭据交给
`POST /api/v1/invitations/redeem` → 兑换在一个事务内把邀请置 REDEEMED、建 INVITED
membership、打开 `tenant.member.admit`（发起者是邀请人）→ 既有 ApprovalWorkflow 等一位
Tenant admin 确认「兑换者就是被邀请的人」→ 批准后完整重新准入 → INVITED→PROVISIONING，
派发既有 `MEMBERSHIP_PROJECTION` → ACTIVE。

## 设计取舍（`.design` 已定的不在此重述）

| 问题 | 结论 | 依据 |
|---|---|---|
| 凭据形态 | 32 字节系统随机数的十六进制；库里只有 SHA-256 摘要（唯一索引，兑换以它加行锁定位）。`Issued` 不实现 `Debug`，明文只经签发回应的 `invitation.link` 出去一次 | DD-83「只存摘要」；AGENTS 规则 11 |
| 链接 | `TENANT_INVITATION_LINK_BASE` + `#` + 凭据。fragment 不随请求发往任何服务端，不进网关与 BFF 的访问日志、也不进 Referer；基址必须是不含 `#` 的 http(s) 地址，启动时校验 | 「origin 取部署配置」 |
| 有效期 | `TENANT_INVITATION_TTL_SECONDS`，签发时冻结进 `expires_at` | 不写死 |
| 过期的判定方式 | 查询时判定，不设回收作业。兑换与撤回都在带 `expires_at > now()` 的同一条语句里落定；列表把过期的 ISSUED 显示为 EXPIRED；库内状态只有 ISSUED/REDEEMED/REVOKED | 作业方案在「作业落后」时留下过期凭据仍可兑换的窗口，且过期后本无副作用要做 |
| 签发/撤回的执行方式 | SYNC，Core 内一次写入。门禁 ALLOWED 与派发 DISPATCHED、INVITATION_ISSUED/REVOKED 的 OUTCOME 审计与邀请行同事务：没有「已允许未派发」的中间态，崩溃即整笔回滚 | DD-09 |
| 签发回应丢失 | 同一幂等键重放回答原 operation，但不再给出凭据（凭据无第二来源）；运维上撤回重发 | 只存摘要的直接后果 |
| 开通的发起者 | 邀请人。兑换者此刻不是成员、不能是准入主体；邀请人的意图是这条链的起点，批准后的重新准入因此检查「邀请人此刻仍有 Tenant manage」 | DD-83、`.design/06` §4 |
| 开通的审批策略 | `TENANT_ADMIN` 一位、`self_approval=ALLOW`、有效期 259200 秒（Catalog 版本，迁移种子） | DENY 会让只有一位 admin 的 Tenant 永远加不进第二个人；确认的是兑换者身份，不是权限扩张 |
| 开通能否由请求体提交 | 不能：`tenant.member.admit` 经 `POST /api/v1/actions` 回 `CAPABILITY_BLOCKED`，只由兑换在 Core 内打开 | 兑换记录才是 invitation fact |
| 开通的幂等与关联 | 幂等键 = 邀请 ID（一份邀请至多一次开通）；`correlation_id` = 签发邀请的 operation，整条邀请按一个 ID 查出 | `.design/03` §8 |
| INVITED 的终结 | 开通的门禁以任何方式关闭（准入拒绝、审批否决/过期/撤回/失效、重新准入不通过、EVALUATING 超过 `ADMISSION_EVALUATION_TIMEOUT_SECONDS` 由对账置 EXPIRED）时，同一事务把 INVITED 置 REVOKED 并记 REVOCATION 审计 | 每个新状态必须回答怎么终结 |
| 兑换者的身份登记 | 与部署引导共用 `external_human.rs`：只在部署 IdP（`HUMAN_OIDC_ISSUER`/`HUMAN_OIDC_CLIENT_ID`）下登记；按 (issuer, subject) 取事务级 advisory 锁，同一人并发兑换先后执行 | `.design/03` §2 的唯一映射 |
| 显示名 | 兑换者自报，只写入首次建立的 HumanIdentity，供审批人对照；不参与任何判定 | BFF 没有经验证的姓名/邮箱 claim（SS-AGW-OIDC） |
| 他 Tenant 在途者 | 兑换者在其他 Tenant 有非 REVOKED membership 时拒绝（`TENANT_SELECTION_NOT_AVAILABLE`），邀请不被消耗 | 一期没有 Tenant 选择入口，兑换成功反而让此人哪里都登录不了 |
| 已撤权者的恢复 | 同一 membership 以新 version 从 REVOKED 进入 INVITED，同一 Principal | `.design/10` §4「重新授权创建新 version」 |
| 邀请列表的一致性 | 整张列表以一次 FullyConsistent 的 Tenant manage Check 为门禁 | 它放出兑换者名字与在途确认；低延迟一致性会让刚失权者继续看到 |

## 每个新状态怎么终结、多久、失败怎么办

| 状态/情形 | 终结 | 上界 | 失败时 |
|---|---|---|---|
| 邀请 ISSUED | 兑换 → REDEEMED；撤回 → REVOKED；到期即视为 EXPIRED | `TENANT_INVITATION_TTL_SECONDS` | 无副作用可失败：过期是时间事实 |
| 兑换后 membership INVITED | 批准并重新准入 → PROVISIONING；门禁关闭 → REVOKED | 审批策略 259200 秒；判定停滞按 `ADMISSION_EVALUATION_TIMEOUT_SECONDS` | 判定时依赖不可用：兑换回 202（EVALUATING），同一人重试兑换再判一次，否则对账作业到期置 EXPIRED → REVOKED |
| 并发兑换同一凭据 | 行锁串行，只一个成功，其余 409 `INVITATION_ALREADY_REDEEMED` | 一次事务 | 回滚，不消耗邀请 |
| 同一 Human 重复兑换 | 回答原结果（200，同一邀请与开通） | — | — |
| 被邀请人已是本 Tenant 成员 | 409 `INVITEE_ALREADY_MEMBER`，邀请保持 ISSUED | — | — |
| 邀请人在兑换前失权 | 兑换成功、开通准入以 `PERMISSION_DENIED` 拒绝，membership REVOKED | 一次请求 | — |
| 邀请人在确认前失权 | 批准后重新准入拒绝 → 门禁 REVOKED、审批 INVALIDATED、membership REVOKED | 一次重新准入 | 重新准入依赖不可用时留给对账作业以同一路径重试，余量不足则让批准按期失效 |
| PROVISIONING 之后 | 既有 MEMBERSHIP_PROJECTION 的状态机与对账（[membership-lifecycle.md](membership-lifecycle.md)） | 同前 | 同前 |

## UI 需要的端点与状态

| 端点 | 调用方 | 说明 |
|---|---|---|
| `POST /api/v1/actions` `{actionKey:"tenant.member.invite", idempotencyKey, name}` | Tenant admin | 200 `ActionSubmission`，`invitation{invitationId, link, expiresAt}` 只在首次回应出现；UI 只展示一次并提示「丢失即撤回重发」 |
| `POST /api/v1/actions` `{actionKey:"tenant.member.invite.revoke", idempotencyKey, invitationId}` | Tenant admin | 200；过期/已兑换/已撤回为 409 与对应 reason |
| `GET /api/v1/invitations` | Tenant admin | `TenantInvitationView[]`：`status` ISSUED/EXPIRED/REDEEMED/REVOKED，兑换者自报名、`membershipState`、`approvalWorkflowId`、`approvalStatus` |
| `POST /api/v1/invitations/redeem` `{credential, displayName}` | 已登录、未必是成员的 Human | 不要求 PlatformSession；200/202 `InvitationRedemptionView`。凭据取自页面 URL 的 fragment |
| `GET /api/v1/invitations/redemptions` | 同上 | 本人兑换过的邀请与进度（`membershipState`、`admissionGateState`、`reason`） |
| `GET /api/v1/approvals`、`POST /api/v1/approvals/{id}/decision`、`/withdraw` | Tenant admin / 邀请人 | 既有端点；开通的审批 `actionKey=tenant.member.admit`、`targetType=TENANT_MEMBERSHIP` |

兑换者等待确认时，`GET /api/v1/session` 回 403 `TENANT_MEMBERSHIP_NOT_ACTIVE`：UI 以
`/api/v1/invitations/redemptions` 判断「等待管理员确认」还是「邀请已终结」。

## 用例与断言面

`core/crates/kailo-core/tests/tenant_invitation.rs`（端到端，真实拓扑）：

| 场景 | 断言（取自 Core 库、zed 或审批投影） |
|---|---|
| 入口 | `tenant.member.add` 与 `tenant.member.admit` 经 BFF 均 403 `CAPABILITY_BLOCKED`；目录无 `tenant.member.add` |
| 无权者 | 非 admin 成员签发 403 `PERMISSION_DENIED`；邀请列表 403 |
| 签发 | 200、DISPATCHED；链接在部署基址下、凭据 64 位十六进制；库里摘要等于 SHA-256(凭据)；同键重放同一 operation、不再给凭据、不多出第二份邀请 |
| 兑换入口 | 无身份 header 403；未知凭据 422 `INVITATION_NOT_FOUND` 且邀请不变 |
| 全链路 | 兑换 → INVITED、门禁 WAITING、发起者是邀请人、关联签发 operation；等待期间无会话、无 `tenant#member`；同人重复兑换回原结果；他人拿同一凭据 409；邀请人本人批准 → ACTIVE、审批 CONSUMED、一次 RECHECK 决定、zed 有 `tenant#member`、会话可建 |
| 已是成员 | 409 `INVITEE_ALREADY_MEMBER`，邀请仍 ISSUED |
| 撤回 | REVOKED；兑换 409 `INVITATION_REVOKED`；再撤回 409 |
| 过期 | 拨回签发时刻后兑换 409 `INVITATION_EXPIRED`、库内仍 ISSUED、列表显示 EXPIRED、撤回 409 |
| 并发兑换 | 两个 subject 同时兑换：恰好一个 200、另一个 409 `INVITATION_ALREADY_REDEEMED`，只一条 INVITED |
| 否决 | 非 admin 否决不形成决定；admin 否决 → 门禁 DENIED（`APPROVAL_DENIED`）、membership REVOKED、邀请仍 REDEEMED、一条 REVOCATION 审计 |
| 恢复与撤回确认 | 同一人再兑换新邀请复用原 membership；邀请人撤回审批 → REVOKED |
| 邀请人兑换前失权 | 兑换回应门禁 DENIED、`PERMISSION_DENIED`、membership REVOKED |
| 邀请人确认前失权 | 批准后门禁 REVOKED（`PERMISSION_DENIED`）、未派发、审批 INVALIDATED、membership REVOKED |
| 凭据不外泄 | 本次签发的每个凭据都不出现在审计 evidence/参数摘要、ActionExecution 参数、邀请行任一列与 Core 容器日志中 |

凭据也不进 Workflow history：ApprovalWorkflow 的 input 只含 ActionExecution、目标与参数
摘要（`approval_input`），开通的规范化参数只有 Principal 与邀请 ID。

## 怎么跑

- 单跑：在 apps 根目录 `. core/verify/integration-env.sh` 后
  `cd core && cargo test -p kailo-core --test tenant_invitation`（约 20 秒）。
- 全量：`bash core/verify/run-integration.sh`。

## 实测结果（2026-09-25）

- `tenant_invitation` 1 passed（18.9 秒）；`run-integration.sh` 全部通过，含
  `governed_action`、`role_management` 与 Worker 的 `go test ./...`（含 replay）。

## 破坏核验（每条都重建 Core 后实际跑过，均已还原）

| 破坏 | 结果 |
|---|---|
| 门禁关闭时不终结 INVITED | 「否决后 membership REVOKED」超时失败 |
| 过期的邀请仍可兑换（去掉预判与落定语句里的时刻比较） | 过期兑换得到 200 WAITING，断言 409 失败 |
| 兑换去掉行锁、落定不看状态 | 并发兑换的落败方不再得到 `INVITATION_ALREADY_REDEEMED`（得到依赖错误），失败 |
| 开通不经 admin 确认 | 兑换回应不是 WAITING，失败 |
| 凭据写进审计 evidence | 「明文凭据进了库」失败 |
| 已撤回的邀请仍可兑换（只去掉预判） | 落定语句的状态条件拦下，但答成 `INVITATION_EXPIRED`，断言 `INVITATION_REVOKED` 失败 |

## 已知边界

- 显示名由兑换者自报：审批人需以带外方式确认兑换者就是被邀请的人，这正是需要确认的
  原因——链接持有即用，可被转发。
- 首位成员仍只由部署引导建立（ADR-11 复评）：没有有效 admin 就没有人能签发邀请。
- 兑换者在他 Tenant 有在途 membership 时不能兑换，直到一期之后出现 Tenant 选择入口。
