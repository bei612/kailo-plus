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
那段边界上出现。实测两种拒绝都留了痕：

| 请求 | `result_code` | evidence |
|---|---|---|
| 不带任何身份 header | `IDENTITY_HEADER_MISSING` | `IDENTITY_HEADER_MISSING` |
| 伪造 issuer 与 subject | `IDENTITY_UNKNOWN` | `EXTERNAL_SUBJECT_SHA256` |

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
