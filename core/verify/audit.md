# AuditEvent 核验

对应 `.design/03` §9 与 `DD-52/54`。

## 追加式是库里的事，不是约定

`audit.audit_event` 上有触发器，`UPDATE` 与 `DELETE` 直接报错：

```text
ERROR:  audit.audit_event 是追加式审计事实，不接受 UPDATE 操作
ERROR:  audit.audit_event 是追加式审计事实，不接受 DELETE 操作
```

**用触发器而不是 `RULE ... DO INSTEAD NOTHING`**：后者让调用方收到「UPDATE 0」
并当成成功，一个以为自己清理过审计的作业会一路安静地跑下去——那正是
「成功但不可核验」。第一版写的就是规则，实测发现 `DELETE` 返回成功、行还在，
随即改掉。

也不只靠权限：迁移与应用共用同一个数据库角色，`REVOKE` 挡不住拥有者自己。

## 审计不加外键，这是有意的

`tenant_id`/`workspace_id`/`action_execution_id`/`human_identity_id`/两个
`principal_id` 都不带外键。审计要比它记录的对象活得久：`07` §4 规定恢复不得删除
历史 Audit，那么审计就不能反过来卡住这些对象的删除。

第一版加了外键，实测立刻出问题：核验夹具的 Tenant 清理被静默挡住，库里攒下几轮
删不掉的租户——而夹具那时用 `let _ = ...` 吞掉了错误，所以没人发现。两处都改了：
去掉外键，清理不再吞错误并在最后复核。

代价是审计里的 ID 会指向已不存在的行。那正是审计该有的样子：它记的是当时发生过
什么，不是现在还剩什么。

## 实测结果（2026-09-23）

| 性质 | 结果 |
|---|---|
| 非 `AUTHENTICATION`/`SESSION` 类型缺 `tenant_id` | 被 `tenant_required_except_auth_boundary` 拒绝 |
| `AUTHENTICATION` 既无 `human_identity_id` 也无 evidence | 被 `auth_boundary_has_no_principal` 拒绝 |
| `AUTHENTICATION` 带不可逆 subject 摘要 | 接受 |
| 同一 `event_key` 写第二次 | 被唯一约束拒绝——「重试不得复制同一审计事实」的执行点 |
| `UPDATE` / `DELETE` | 两者都报错，行保持原值 |

## 认证边界留痕（`DD-52/54`）

`tenant_id=NONE` 只允许在「网关已验过 OIDC、Core 还没解析出可用 TenantMembership」
那段边界上出现，并须以 HumanIdentity 或外部 subject 摘要归因（DD-52）：

| 请求 | `result_code` | 审计 |
|---|---|---|
| 伪造 issuer 与 subject | `IDENTITY_UNKNOWN` | 留痕，evidence 为 `EXTERNAL_SUBJECT_SHA256` |
| 不带任何身份 header | `IDENTITY_HEADER_MISSING` | 请求照样 `403`，不写审计：没有可摘要的 subject，也没有 HumanIdentity，按 DD-52 不构成可成立的审计事实；Core 记一条带原因码的 warn 日志（网关未投影身份 header 是 `SS-AGW-OIDC` 链路上的基础设施信号） |

本次修改之前，实现为缺 header 的拒绝写入一条种类为 `IDENTITY_HEADER_MISSING` 的占位 evidence 以通过 `auth_boundary_has_no_principal` 约束；审计表只追加，这些存量行保留，解引用时按不可识别种类显示不可用。

摘要的三条性质都验了：

- 审计表里查不到 `nobody`/`forged` 任何明文（计数 0）——外部 subject 在很多 IdP
  上是邮箱或可反查的账号名，原样记会把它散进审计表；
- 同一 issuer + subject 两次拒绝得到**同一个**摘要，因此仍可关联到同一个人；
- 不同 issuer 的同名 subject 得到**不同**摘要——issuer 参与摘要，两个 IdP 下的
  同名 subject 不是同一个人。

依赖不可用（`UNKNOWN`）不记：那不是一次身份判定，记下来会把运维故障混进拒绝审计。

审计写失败只记日志、不改变响应：请求已经被正确拒绝，再因为审计写不进去返回另一个
错误，会把一次正确的拒绝变成一次看起来像故障的响应。缺口由 `07` §3 的审计缺口
度量兜底。

## 范围审计与 EvidenceRef 解引用（V-SCN-43、DD-52）

EvidenceRef 的种类收敛为契约封闭枚举 `evidence_kind`；权威源与敏感级别由种类唯一确定（Core `audit::describe`），全部写入方经类型化构造写入，序列化形状仍为 `{kind, value[, version]}`——审计表只追加，存量不能改写，新旧条目因此是同一种形状。存量中不在枚举内的种类（`TENANT_MEMBERSHIP_STATE`、`TENANT_MEMBERSHIP_VERSION`、`SECRET_VERSION`、`IDENTITY_HEADER_MISSING`）与值缺失的条目解释为不可识别，不猜测含义；写入方不再产生它们：成员状态并为带 version 的成员 ID 引用，运营者密钥的 KV 版本并入新公钥引用的 version，审批策略版本改用 version 字段（存量 `<id>@<version>` 仍按同一条策略核对），`Option` 为空时不再写入 `value: null` 条目。`publish_reconcile` 只把可识别条目带入结果审计，不可识别条目留在 DISPATCH 原行并计 `EVIDENCE_PARTIAL`，不阻止结算。

`GET /api/v1/audit/events` 读当前 Tenant（或所给 Workspace，须属于当前 Tenant）范围内的事件，调用方须对该范围持有 `audit`，每次 FullyConsistent 判定；列表只给证据种类、权威与敏感级别，不给稳定 ID。`GET /api/v1/audit/events/{id}/evidence/{index}` 按事件自己的 scope 重新授权（Workspace 事件查该 Workspace 的 `audit`，其中含 Tenant 的 `audit`）；`RESTRICTED`（外部 subject 摘要、平台会话）在 ResultExposure 交付前一律不可用；Core 自有证据核对原对象仍在当前 Tenant；外部权威的证据逐种向权威源查证存在性（2026-09-28 修订，见下文“存在性查证”）：Temporal workflow 以 describe 查证，run 绑定同一事件唯一的 workflow 查证，SpiceDB 关系以强一致读查证；BFF 没有可查接口的种类（ZedToken、Buzz）与无法绑定 workflow 的 run 为 `UNVERIFIABLE`，同样只显示不可用；查实不存在回 404，权威源不可达回 503。

2026-09-28 实测（`--fresh` 后的本地拓扑，`core/verify/run-integration.sh` 退出 0，29 批；其中 `tests/audit_evidence.rs` 1/1）：普通成员读 Tenant 范围 `403`；授予 Tenant `auditor` 后 `200`，列表合 `AuditEventPage` 契约且不含 `stableId`；游标之后的页不含游标本身；不属于本 Tenant 的 Workspace 作范围 `403`；Tenant auditor 解引用 Workspace 事件可用；`TEMPORAL_WORKFLOW_ID` 解引用回库中同一稳定 ID；外部 subject 摘要 `RESTRICTED`、存量 `TENANT_MEMBERSHIP_STATE` 为 `UNRECOGNIZED`、不存在的 `ACTION_EXECUTION_ID` 为 `NOT_FOUND`，三者都不回任何 ref 内容，越界位置 `404`；审批策略的 version 字段、存量 `<id>@<version>` 两种形状都可用，版本不存在为不可用；别的 Tenant 的事件 `404`；撤销 `auditor` 后列表与解引用立即 `403`；Workspace auditor 只读到该 Workspace 的事件，读 Tenant 范围与解引用 Tenant 级事件均 `403`。

破坏核验：去掉 `RESTRICTED` 拦截后重建 Core 重跑同一入口，用例在外部 subject 摘要一步失败（回应带出 `stableId`，`available=true`），还原后重建复跑 29 批全绿。本次提交前在该版本上以管理员身份在真实浏览器进入审计页：范围审计区块列出事件，点开一条 Workflow 证据经解引用显示 Temporal 权威与稳定 ID，全程无失败响应与页面错误。前端 `pnpm -r test` 64/64，覆盖无权不渲染、仅有 Workspace 权限时可改选 Workspace、判定不明显示可重试、解引用 403 与不可用证据不显示任何 ref 内容。

未覆盖：`tenant_id` 为空的认证边界事件没有租户范围可授权，这两个端点不返回它们；ResultExposure 与目标组件 binding 对解引用的授权在其交付后接入，在此之前 `RESTRICTED` 一律不可用；Mobile 不提供范围审计。

## 生命周期跃迁留痕

与状态变化**同事务**。分成两次提交，崩在中间就得到一次「发生过但没人记得」的
撤权，而那是审计唯一要防的东西。

实测一次完整核验后的记录：

```text
OUTCOME|scope.transition|WORKSPACE|ACTIVE
OUTCOME|scope.transition|TENANT|ACTIVE
REVOCATION|membership.transition|WORKSPACE_MEMBERSHIP|REVOKED
OUTCOME|membership.transition|WORKSPACE_MEMBERSHIP|ACTIVE
REVOCATION|membership.transition|TENANT_MEMBERSHIP|REVOKED
OUTCOME|membership.transition|TENANT_MEMBERSHIP|ACTIVE
```

`REVOKED` 记 `REVOCATION` 而不是 `OUTCOME`：撤权在 `.design/03` §9 的类型表里是
独立一类，混进 `OUTCOME` 会让「按撤权取证」漏掉记录。

`event_key` 由 workflow ID、目标与目标状态构成，因此同一次跃迁重试算出同一个键，
唯一约束据此拒绝第二条。

## 残留

审计行不清，这是设计如此。核验跑完后库里只剩 Catalog Tenant 与若干审计行，
后者指向已被删除的 Tenant——见上文「审计不加外键」。

## 存在性查证（2026-09-29）

复核发现解引用对 Temporal、SpiceDB、Buzz 等外部权威的证据一律当作可用，前端对 404 显示“加载失败/
重试”。现 `audit_views::evidence_existence` 对每个 `evidence_kind` 写明结论、不设通配：Core 表查库；
Temporal workflow 以 describe 查证；run 绑定同一事件唯一的 workflow 查证，无法绑定为 `UNVERIFIABLE`；
SpiceDB 关系以强一致读查证；BFF 没有可查接口的 ZedToken 与 Buzz 种类为 `UNVERIFIABLE`。查实不存在回
404（只带 `NOT_FOUND` 原因），`UNVERIFIABLE` 回 200 的不可用视图，权威源不可达回 503；契约
`evidence_unavailable_reason` 增加 `UNVERIFIABLE`，四侧重新生成。前端 404 显示“不可用”、不给重试，
503 与网络错误才可重试。

证据：`core/verify/run-integration.sh` 退出 0、31 批，含 `scope_audit_and_evidence_are_authorized_per_request`
（不存在的 Temporal workflow/run 回 404；无 workflow 可绑定的 run 与 ZedToken 为 `UNVERIFIABLE` 且不带 ref
内容；夹具真实 workflow 可用）；Core 单元 `run_id_binds_only_to_a_single_workflow_in_the_same_event`、
`relationship_evidence_parses_only_the_written_shape`；`pnpm --dir web/packages/platform test` 76 通过（404、
503、`UNVERIFIABLE` 三种显示与中文 404）；`web-walkthrough.sh` 20/20。
