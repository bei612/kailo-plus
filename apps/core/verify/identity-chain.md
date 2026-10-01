# 身份链核验：AgentGateway → BFF

对应 `.design/09` 第 1–2 步与 Stage 1 退出门禁中的
「外来身份 header、缺失 header 全部被拒绝」「Core `REVOKING` 在对账完成前即拒绝新动作」。

## fail closed：绕过网关直连 BFF

BFF 只在 `app` 网络，Browser 到不了它；下列请求从网络内部发起，
模拟「网关被绕过」这一最坏情形。

| 请求 | 结果 |
|---|---|
| 无任何身份 header | `403 {"class":"DENIED","reason":"IDENTITY_HEADER_MISSING"}` |
| 伪造 issuer 与 subject | `403 {"class":"DENIED","reason":"IDENTITY_UNKNOWN"}` |

第二条是关键：伪造 header 也拿不到执行身份，因为 subject 不在
`identity.external_identity` 中。没有自动建号，也没有默认 Tenant 兜底。

## 正向：完整 OIDC 登录后经网关访问

登录后带会话访问 `/api/v1/session`，**同时携带伪造的 `x-kailo-oidc-subject: FORGED`
与 `x-kailo-tenant: FORGED`**：

```json
HTTP 200
{"humanIdentityId":"11111111-0000-0000-0000-000000000001",
 "tenantId":"11111111-0000-0000-0000-000000000003",
 "tenantMembershipId":"11111111-0000-0000-0000-000000000005",
 "tenantPrincipalId":"11111111-0000-0000-0000-000000000004"}
```

返回的是从**已验证** subject 解析出的身份，伪造值对结果没有任何影响。

## membership 状态直接控制准入

同一会话下，只改 `identity.tenant_membership.state`：

| 状态 | 结果 |
|---|---|
| `ACTIVE` | `200`，返回解析出的身份 |
| `REVOKING` | `403 {"class":"DENIED","reason":"TENANT_MEMBERSHIP_NOT_ACTIVE"}` |
| `REVOKED` | `403`，同上 |
| 改回 `ACTIVE` | `200` |

`REVOKING` 立即拒绝，不等对账完成——这正是退出门禁要求的行为。
会话本身没有被销毁，拒绝来自每次请求重新解析 membership，
而不是依赖某个缓存或登出动作。

## 核验夹具

上面几节的结果最初用一个手写 ACTIVE Tenant 与成员的脚本取得。该脚本已删除：
现在的核验身份一律由 `core/crates/kailo-core/examples/verify_workspace.rs` 建立，
它复用集成测试的夹具，Tenant、Workspace、两级成员与 Buzz binding 全部走
`TENANT_LIFECYCLE`/`WORKSPACE_LIFECYCLE`/`MEMBERSHIP_PROJECTION` Workflow，
只有 OIDC subject 取自 IdP 里真能登录的核验用户。经网关的整条链由
`core/verify/web-walkthrough.sh` 在真实浏览器里重跑（见
`upstream/buzz-web/kailo/verify/web-surface.md`）。

## PlatformSession（2026-09-23）

会话不由 Browser 携带：网关只投影 issuer/subject，Core 据此重新解析身份，再找出
或建立该 `(HumanIdentity, TenantMembership)` 的 active 会话。直接后果是**撤销立刻
对下一个请求生效**——不依赖客户端丢弃任何东西，外面也没有一张需要等它过期的凭证。

实测：

| 步骤 | 结果 |
|---|---|
| 首次解析 | `200`，返回新建的 `platformSessionId` |
| 再次解析 | `200`，返回**同一个** `platformSessionId`；库里仍只有 1 条 |
| 成员经 service API 进入 `REVOKING` | `{"state":"REVOKING","version":2}`；会话同一事务内变为 `REVOKED` |
| 撤权后立刻再请求 | `403`，且不再建新会话（身份解析先失败，走不到建会话那一步） |

一个 `(HumanIdentity, TenantMembership)` 同时至多一条 active 会话。不为同一个人
同一个 Tenant 开第二条，否则「撤销会话」会变成需要遍历的动作，而遍历总有漏网的。

撤会话与 membership 跃迁同事务（`.design/03` §3 要求「进入 `REVOKING` 时立即撤销
其 PlatformSession」）。分两次提交，崩在中间就得到一个已被撤权却还能继续发请求的
会话——而 `REVOKING` 的全部意义就是立刻关门。

过期判定按库里的 `now()`，不按进程时钟：多副本 Core 的时钟不保证一致，用各自的
时钟会让同一条会话在一个副本上有效、在另一个副本上过期。

## 注销（`SS-AGW-OIDC` 的 Kailo 半边）

接缝把注销分成两半：网关清本地 cookie，Kailo 在同一条成功路径上撤销 Core
PlatformSession 并关闭 BFF stream。

**顺序不能反。** 网关的 logout 是短路的——`handle_logout` 返回带 `direct_response`
的 `PolicyResponse`，链路随即中断，请求根本不到后端（`SF-AGW-21`）。先调网关就
再也没机会告诉 Core，PlatformSession 会一直留到过期。已写进 `07` §1。

实测：

| 性质 | 结果 |
|---|---|
| 调 `POST /api/v1/logout` | `200 {"revoked": true}`；会话不再是 `ACTIVE` |
| 已建立的 SSE 流 | 在登记的上界内收到 `closed: session-revoked` |
| 会话已撤后再注销 | `200`——注销是幂等的，重复调用不该报错 |

只撤调用方自己那一条会话：同一个人可能在另一台设备上还开着，注销一台不该把另一台
踢掉。要踢全部是撤权，不是注销。

## 撤权对长连接生效的上界

请求/响应路径每次都重新解析身份，撤权因此对**下一个请求**立刻生效。一条已经建立
的 SSE 流不再经过那条路径，所以它自己按 `BFF_STREAM_READMIT_SECONDS` 回头看。

这个间隔是撤权对已建立流生效的上界，因此是部署登记值而不是常量——不登记它，
被撤权的人能继续收到事件而没有上界。它与 `BUZZ_NIP43_RECONCILE_INTERVAL_SECS`
同类：都是必须被说出来的时间窗。

再准入查不动数据库时关流并给 `readmission-unavailable` 而不是 `session-revoked`：
前者是结果不明，客户端应当重连；后者是确定的撤销，客户端不该重连。把两者混为
一谈会让一次数据库抖动表现成"你被登出了"。

## Principal 与 TenantMembership 同租户核验（2026-09-27）

本节是本地开发环境的证据，不表示生产环境已发布。
`.design/03` §2 要求 HUMAN Principal 为同 Tenant 的 active 身份；原解析查询
只检查 ExternalIdentity、HumanIdentity 与 TenantMembership，未检查 Principal。
`20260927110000_tenant_principal_scope` 为 Membership 的
`(tenant_principal_id, tenant_id)` 增加到 Principal `(id, tenant_id)` 的复合外键；
解析仍逐次核对 Principal 的 Tenant、kind 与 status，不把数据库约束当作状态检查。

业务库的只读前置查询中，现存跨 Tenant Membership/Principal 行数为 `0`；
已在备份后向 `kailo-local` 开发库应用新迁移。
独立核验库 `kailo_rehome_verify_20260927` 应用新迁移成功；
`KAILO_INTEGRATION=1 cargo test -p kailo-core --test identity_principal_scope`
在 8 GiB/400% cgroup 下退出 `0`，`1 passed`：正常 HUMAN 身份可解析；
Principal `DISABLED` 或改为 `AGENT` 时解析与既有 Session 再准入均拒绝；
跨 Tenant Membership 插入被
PostgreSQL 外键以 `23503` 拒绝。临时移除解析的 Principal 检查后，
同一用例以「停用 Principal 仍能取得执行身份」退出 `101`；恢复源码后重新运行
退出 `0`。夹具按精确 UUID 清理，未修改业务库身份行。

受 16 GiB/500% cgroup 限制的 `./tools/check.sh --full` 最终十组全部通过，
包含迁移前进、回退、再前进。此前一次全量运行的 `cargo test` 步骤返回失败，
门禁隐藏了原始诊断；随后同环境的原始 `cargo test` 退出 `0`，再次全量运行也退出
`0`。这次波动尚无可归因的失败日志，不能据此宣称测试完全无间歇性。

## 已建立事件流的 Workspace 撤权（2026-09-27）

原 `Readmission` 只复查 Session 与 signer；已打开的 SSE 在
WorkspaceMembership 撤权后仍继续接收事件。现在每次再准入同时复查 Tenant、
Workspace、WorkspaceMembership 与两侧 Buzz binding，若 scope 的版本、Channel
或 Community host 改变也关闭旧订阅。依赖查询失败发
`readmission-unavailable`，不伪装成已撤权。

新 Core 已在受限构建器内完成 release build，并由 `start-core.sh` 重建本地
`kailo-local-core-bff-1`。真实连接的 `stream_delivers_snapshot_and_generation`
用例先收到 `live`，随后把该成员置为 `REVOKING`，在再准入上界内收到
`closed`／`scope-revoked`；新建同 scope 的连接也被拒绝。用例退出 `0`，
`1 passed`。将断言临时改成不可能的关闭原因后，同一用例退出 `101`，实际帧为
`event: closed`、`data: scope-revoked`；恢复断言后再次退出 `0`、`1 passed`。
完成上述改动后，受 16 GiB/500% cgroup 限制的 `./tools/check.sh --full`
重新运行，十组全部通过，最终退出码 `0`。

## 撤权后残留的 Workspace admin 与 WorkspaceMembership 复活（2026-09-29，V-SCN-34/35）

Stage 2 独立复核发现两处与 `.design/10` §5 矛盾：Workspace 成员撤权只撤 `member` 关系，其
`workspace#admin` 仍使 `workspace manage` 为真，准入在成员非 ACTIVE 时凭它放行；Tenant 成员撤权不
处理其 WorkspaceMembership，按邀请恢复沿用同一 Principal 时旧的 ACTIVE 投影随之复活。

修正：准入在该人有过但当前非 ACTIVE 的成员关系时只接受 fresh Tenant `manage`（从未加入的 Workspace
admin 仍按 `03` §2、DD-50 以 `workspace manage` 放行）；撤 Workspace 成员时删除此人在该 Workspace 上的
全部关系（GetVersion 门控）；Tenant 成员进入 `REVOKING` 的同一事务把其全部未撤 WorkspaceMembership
推进到 `REVOKING`，由同一撤权 Workflow 先 SpiceDB、再各 Channel roster、再 relay roster 收敛到
`REVOKED`；尚有非终态 WorkspaceMembership 时 Tenant 成员不得进入 `REVOKED`。迁移
`20260929100000` 只把存量数据往拒绝方向推。

证据（本地拓扑）：`core/verify/run-integration.sh` 退出 0、31 批 `test result: ok`，含
`membership_lifecycle_converges_both_directions`（持有 `workspace#admin` 的成员进入 `REVOKING` 即被拒
`SCOPE_GUARD_FAILED`，`REVOKED` 后 admin 关系已删、仍被拒）与
`invitations_are_redeemed_once_confirmed_by_an_admin_and_always_terminate`（Tenant 撤权后
WorkspaceMembership 连带 `REVOKED`、`workspace#member` 已删；按邀请恢复后仍为 `REVOKED`、SpiceDB 无该
关系、`/api/v1/workspaces` 不可见）；Worker 单元 `TestTenantRevocationConvergesWorkspaceMembershipsFirst`、
`TestWorkspaceRevocationRevokesAllRelationsOnWorkspace` 通过。

破坏核验：把非 ACTIVE 分支改回凭 `workspace manage` 放行、并让 Tenant 撤权不再推进 WorkspaceMembership，
重建 Core 后定向运行：前者在“REVOKING 的 Workspace 成员凭 workspace admin 仍被放行”处失败（200≠403），
后者在“等待超时：B 的 TenantMembership REVOKED”处失败；还原并重建后全套 31 批通过。两次失败保留的夹具
Tenant `060e8796-960c-4450-b2ca-1a3aff4bd1e1`、`b5ca5ffa-a034-46d5-b862-88963d03706a` 待受治理的
`tenant.delete` 落地后删除。

## 同一成员的并发会话簿记（2026-09-30，DD-112）

原 `identity::session::ensure` 对 active 会话先查后插，两次查询不在同一事务，
数据库也没有该成员 active 会话的唯一约束。串行登录的历史核验不能证明并发首写
幂等；两个 Core 副本同时读到空结果时均能插入。这是既有会话合同的缺陷，不新增
登录、换钥或会话管理能力。

修正复用已有 TenantMembership 行：在事务内按 HumanIdentity 与 Membership ID
取得仍为 `ACTIVE` 的成员行锁，再查找或创建会话并提交。成员撤权的两条生产调用
（`membership_state::transition_membership` 与 `governance::allow_in_tx`）都先更新
TenantMembership，再在同一事务调用 `revoke_for_membership`；会话路径保持同样的
成员行、会话行锁序。撤权先提交时，会话创建不能越过新的成员状态；会话先提交时，
撤权随后撤销它。锁只覆盖本地数据库操作，不跨 SpiceDB 或 Relay 调用。

`ensure` 的 Rust 错误类型改用已有 `IdentityError`，两处 BFF 调用直接保留该类型。
锁后成员已非 ACTIVE 是 `DENIED / TENANT_MEMBERSHIP_NOT_ACTIVE`；实际数据库故障
仍为 `PRECONDITION / DEPENDENCY_UNAVAILABLE`。成功响应、入参、部署 TTL、状态枚举、
数据库 schema、四语言契约与 Workflow history 不变；不补写旧数据或另立会话权威。

最新源码在 6 GiB MemoryMax、400% CPU 的 cgroup 内运行 `cargo fmt --all --check`、
`SQLX_OFFLINE=true cargo clippy --all-targets -- -D warnings` 与现有 Core workspace
`cargo test`，退出 `0`，用时 1 分 33.199 秒。完整原始日志：
`/volumes/data/kailo/tmp/codex-session-final-check-20260930.log`。
该次未设置 `PLATFORM_INTEGRATION=1`，带此开关的身份及真实服务用例提前返回，
不能据其 `ok` 行宣称并发登录、撤权竞态或新 Core 容器已实际验收。
本记录不关闭 Stage 1 或生产发布门禁。

随后直接调用当前源码编译出的 `identity::session::ensure`，对现有开发库中一位
已有 ACTIVE 成员且尚无 live 会话的真实用户同时发起 32 次调用：全部成功，
返回的不同会话 ID 数为 `1`，提交后的 live 会话行数为 `1`，随后再次调用仍复用
该 ID。没有建立新身份、Tenant、成员关系或夹具，没有撤销用户或删除会话；只产生
该生产函数本来就负责的会话簿记。一次性调用程序位于仓库外
`/volumes/data/kailo/tmp/session-existing-user.dYAZKS`，复用现有 Core target 与
Cargo cache，在 6 GiB/400% cgroup 内退出 `0`，用时 10.131 秒；原始日志：
`/volumes/data/kailo/tmp/codex-session-existing-user-20260930.log`。
这证明当前库上的并发首写与后续复用，不证明撤权竞态的实跑、OIDC 浏览器链或
正在运行的旧 Core 镜像已带上该修正。

## 新 Core 的实际运行核对（2026-10-01 UTC）

随后使用既有 `deploy/local/start-core.sh` 构建并重建开发环境 Core：构建完成后
才领取新的 OpenBao wrapping 投递，没有复用已消费的凭据或直接 restart。
命令退出 `0`；容器镜像 ID 为
`sha256:8da30c70e4a62bfd0fa652642416c3f0d0390a79a677eb884a46f7e8f2ef8862`，
启动时间为 `2026-10-01T00:22:05.249660251Z`，实际 `/healthz` 为 HTTP `200`。
构建日志为 `/volumes/data/kailo/tmp/codex-session-core-deploy-20260930.log`；
容器与健康证据为 `/volumes/data/kailo/tmp/codex-session-core-runtime-20261001.log`。

沿用现有 Web 走查的 Playwright 登录方式，对部署中的既有管理员执行真实
Gateway → IdP → Web 登录，然后由同一浏览器并发读取 32 次 `/api/v1/session`。
实际结果：32 次全部 HTTP `200`，每条均有有效 `platformSessionId`，不同 ID 数为
`1`，随后再次读取仍复用该 ID。没有新建身份、Tenant、成员或夹具，也没有撤权、
发送消息或执行删除。一次性调用位于仓库外
`/volumes/data/kailo/tmp/codex-session-existing-browser-20261001.mjs`，
在 2 GiB/200% cgroup 内退出 `0`、耗时 3.373 秒；原始日志为
`/volumes/data/kailo/tmp/codex-session-existing-browser-final-20261001.log`。

首轮一次性调用误把 Rust 字段 `platform_session_id` 当成 JSON 字段，
因此在 32 次 HTTP `200` 后以“字段缺失”退出 `1`；它没有把 undefined 当作一个
有效会话通过。按既有 `contracts/api/session.schema.json` 的 `platformSessionId`
修正调用后通过，没有改变产品响应；首轮失败日志保留为
`/volumes/data/kailo/tmp/codex-session-existing-browser-20261001.log`。

此 Core 镜像来自当前完整开发工作树，不是选定源码提交的生产发布证明；
运行核对证明新 Core 的真实登录与并发会话复用，不证明撤权竞态、原生端签名包、
Tenant 删除或 Stage 1/2 的全部退出条件。本批未关闭这些门禁。
