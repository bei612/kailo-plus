# CapabilityContract Catalog 管理接线

## 实施边界（2026-10-04）

权威为 `.design/03` §3、`05` §2.8、`07` §2.4、DD-88/DD-102，以及
`02-纵向交付路线.md` EXT-BASE 的登记人与批准人分离要求。本切片只实现
Catalog HUMAN 的 register → DRAFT → approve → ACTIVE → deprecate → DEPRECATED
及受权分页目录，不实现 ComponentRelease、ApplicationBinding 或业务能力消费。
没有借 Agent Stage，也没有使 Cells/WeKnora/Wren 变为平台核心前提。

四步影响结论：

1. 权威与写者：原 ActionCommand → Governance → 原 ActionExecution/Operation，
   Catalog 内容、真实 schema 与测试向量及其 digest 在同一准入事务固定；批准继续
   使用 ApprovalWorkflow，不建立第二审批或注册权威。
2. 读者与兼容：BFF 只返回同 Catalog Tenant 经 fresh manage Check 的分页元数据；
   Web/Desktop 共用平台 TS 消费同一生成 DTO。ActionCommand 仅增加可选字段，
   原动作不得携带这些字段；Mobile 没有新增管理入口。
3. 副作用：只有 Core Catalog 事务写入，没有 adapter/native 业务调用或 consume
   授权。ACTIVE 内容不可变，弃用不修改旧引用。类别预置种子和新的平台语义不
   由本入口伪造；当前未编译的 ProtocolSession kind 拒绝登记。
4. 异常：无 Catalog/fresh 权限、失效或过期审批、原登记人审批均拒绝；数据库或
   授权读取未知不按成功返回。schema 校验复用固定 jsonschema 0.33.0 的内置
   meta-schema 与 validator，默认 HTTP/file resolver 关闭，只允许实际登记文档集
   内的引用，不自行解释 JSON Schema、不拉取远端引用。

固定验证器 API 依据：
[meta::try_validate](https://docs.rs/jsonschema/0.33.0/jsonschema/meta/index.html)、
[ValidationOptions](https://docs.rs/jsonschema/0.33.0/jsonschema/struct.ValidationOptions.html)、
[Retrieve](https://docs.rs/jsonschema/0.33.0/jsonschema/trait.Retrieve.html)。

本段记录已写源码和边界，尚不代表集中 Core 编译、迁移或业务验收通过；本批未
发布、部署或登记真实契约，已有 release digest 仅记录旧产物，不证明本切片已交付。

## 共享 Web/Desktop 消费端实测（2026-10-04 07:38 UTC）

在原 Workspace 管理页复用 `@client-kit/platform` 的单一 TS 主体、BFF Client、
主题和治理回执组件；未新建 Web 页面主体或 Mobile 管理入口。登记提交固定的
真实 schema/test-vector 文档，批准和弃用提交列表返回的精确自然键版本。登记
与弃用必须显式确认；批准等待原 ApprovalWorkflow，不显示为已批准。

客户端影响面：原 ActionCommand 四侧生成契约、分页 BFF 元数据、共享页面和
双语目录；无数据库或上游调用写入。空目录可展示登记入口，初次 403/404 不
生成管理入口；非法枚举、digest、权限组合或分页游标拒绝展示。认证身份切换
重置整棵平台状态。写请求冻结内容及幂等键，UNKNOWN 后的 403/409 不能决定
第一次副作用的终态，继续保留同一请求；并发点击不产生第二次提交。

独立源码快照及日志位于：
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/capability-ui.ynE0v2/`。
使用既有 SDK 镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
没有构建或发布产品镜像。原 `tools/gen.sh` 四侧生成退出 0；正式四侧产物使用
该输出，非手写类型。原 `pnpm --filter @client-kit/platform test` 最终退出 0：
`Test Files 8 passed (8); Tests 258 passed (258)`，其中组件合同 17 项。

实现之后做了两次真实源码变异，均仅在独立快照内操作：

- 删除 UNKNOWN 后续错误的保留条件：`2 failed | 15 passed`，退出 1；断言
  检查结果仍未知且同一请求重查按钮保留，不能仅凭残余提示文字判通过。
- 把批准/弃用引用版本改成 `contractVersion + 1`：`2 failed | 15 passed`，
  退出 1，捕获写入对象与列表对象不一致。

两次均已还原；最终 11 个共享 TS 文件与正式源码逐一 `cmp` 退出 0。原
`python3 tools/gen-platform-i18n.py --check` 退出 0，输出
`PASS: Mobile platform and reason catalogs match the shared TypeScript source`。

| 日志 | SHA-256 |
|---|---|
| `generate.log` | `52b398e382b2959e01fb16033b4e4b80dde009698f1f262ed6881c8f1db4f1f2` |
| `mutation-unknown-exact-retry.log` | `a5c79222aa3f78803a9d2029ff56e8369d4176b2baf9564943179b702712b735` |
| `mutation-contract-ref.log` | `57829694dbcc833199d28e8d48d37382819ed4d92e920efc38e702b4e30ae79c` |
| `restored-final.log` | `0ceb015fc52d7d03cd041bc868e935bcdcf1a1aa2ca8562a3c2c0cd5e620e2af` |
| `i18n-check.log` | `740ff5452b680e6c0b9419bf56d4b4787754c67a74c6cd0f00822dbfc3411b30` |

这些证据证明共享 UI 的消费与失败边界，不证明后端事务、审批服务、迁移、
真实组件调用、全量检查或部署通过；Cells/WeKnora/Wren 集成状态不因此改变。

## 隔离数据库实现后核验（2026-10-04）

复用现存 `kailo-installation-scope-pg-e4agxd`（network=none、2CPU/1GiB）及原
SDK 的 SQLx/psql；仅创建独占库 `capability_family_rsfdrk`，未连接运行库。
原件目录为 `/volumes/data/kailo/tmp/codex-capability-contract-20261004.RSFDrk/`。
固定迁移输入为原链至 10000 加 13000（65 条）；11000/12000 由 Tool 批另验。

- 原 `sqlx migrate run` 退出 0；13000、10000 两次原 `migrate revert` 后再次
  前进退出 0。10000 保留四个原 Operation FK 值，均改指派生的根 AE key。
- 旧 REPEATABLE READ 快照在另一连接提交 child 后修改父 AE，真实报 40001，
  rollback 后父字段未变。两连接 child 准入先沿原父锁序列化（第二连接真实
  等待 transactionid 锁），同事务转 ALLOWED 后均 commit，未产生第二 Operation。
- 13 个 family scope/父关系/不可变反例均 23514；13000 的 DRAFT 注册、原 AE
  关联、ACTIVE 不可变、DEPRECATED 保留旧内容及 14 个拒绝反例检查退出 0。
  曾保留 EVALUATING 夹具触发原唯一 pending target 的 23505，失败原件保留；
  按真实 consumer 同事务完成准入后并发通过，未放宽该原约束。
- 有 child 的 10000 原 down 报 23001、有契约的 13000 原 down 报 23514，
  psql 均退出 3；事务回滚后 65 条迁移、三个 child 和固定弃用契约均仍存在。
- 实际删除两个生产 trigger 的独立事务变异分别令原不可变断言报 P0001、
  退出 3；事务自动还原后两断言退出 0，前后 trigger 定义逐字 cmp 0。
- 从当前真实模块机械提取的 14 条 SQL（含两种锁变体）在 BEGIN READ ONLY
  中原生 PREPARE/ROLLBACK 退出 0，不执行写句。

| 原件 | SHA-256 |
|---|---|
| `migrations-up.log` | `18953e1e7b03cc997a24976a7cdf65905397aeb78b4ffc5153dd4580c1026515` |
| `migrations-down-up.log` | `f439c0ba621f2b9f95a3ca4dea3a1c72466bd3034c01c6e09b5623c3957526b0` |
| `family-rr.log` | `2f07f71b1e43483b532d9c2f6ec578318ed4ec44994517283fa80173b1a68163` |
| `family-guard-mutation.log` | `f464510efe901a34b02ae3605d55265b1ab6d0314aa450cc72bde9021cdab694` |
| `capability-guard-mutation.log` | `4f5c9c4d8a83240e080e4361d6cb210c51d8f40822c154a400884ea0dbccbb0d` |
| `guard-restored.log` | `0cdbad7379ea6c9c92710da01bc266287d0a59e21db67c29583b70387d607298` |

数据库夹具仅证明约束，Tenant/Workspace/Installation 保持 PROVISIONING、Version
保持 DRAFT，无实际权限、native key、模型、RuntimeProfile 或外部调用。它们不
证明受权 Catalog 操作、ApprovalWorkflow、组件 conformance 或 Agent E2E；未部署。
