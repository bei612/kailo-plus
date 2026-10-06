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

## 版本化机器向量登记（2026-10-04）

本批基线为树 `bc997abb306b2ffe62da32274460083a98187cfc`。直接修正原登记路径
将任意非空对象数组当作测试向量的问题：`CapabilityConformanceVectors` 的 V1
编码固定有序 case/step、contractKey、实际 inputJson 与 expectedOutputJson。
Core 拒绝自然语言数组、未知格式/字段、空 case/step、重复标识、未登记契约键、
漏掉任何 operation contract，以及不符合该操作实际输入/输出 schema 的值。
步骤顺序参与摘要，内层 JSON 的空白和对象键顺序不产生第二个 suite digest。
这只是能力契约元数据登记校验，不代表适配器真的执行了这些步骤。

四步影响结论：

1. DD-102、`03` §3、`07` §2.4/§8A 与 ADR-12 决定向量是平台运行器的数据，
   不是用户上传的“pass”或可执行文本。本批没有添加 runner、报告签名或 Release
   入口；后续实际套件与隔离环境取证仍必须闭合，不能把登记通过当执行证明。
2. 写者仍是原 `capability_contract.register`；目录只读摘要，不返回向量正文。
   新类型来自 contracts，四侧生成；Web/Desktop 仍共用原页面，Mobile 无新入口。
   原 testVectorsJson 字段不变，但内容收紧为 V1；旧自然语言数组不兼容、不双读。
3. Core 仍复用原 jsonschema 库和关闭外部解析的 retriever；不执行网络、模型、
   代码片段或业务数据库操作，不改变权限/审批/额度/审计权威。
4. `14000` 在空 Catalog 上将 test_vectors 的约束从 array 收缩为 V1 envelope，
   缺格式、缺 cases 不能利用 SQL NULL 通过。已有任意不可变契约时停止迁移；
   有新格式记录时停止回滚，不改写摘要、不自动生成预期值、不删除旧记录。
   迁移失败须停止发布并处理真实旧数据，不能把历史隔离库零行当生产事实。

原件与隔离验证目录：
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/component-vectors.YyRwwt/`。
使用既有 `kailo-installation-scope-sdk-e4agxd`，镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
回读实际 4 CPU、8 GiB memory/memory+swap、Data cache，Cargo jobs 保持 16。

实际命令与输出：

- `bash tools/gen.sh`：四侧 OK，退出 0；首次在线 npm 元数据查询较慢，终止
  本任务该次生成进程后使用同一已缓存固定 quicktype 离线重跑成功。
- 原 `tools/check.sh` 的 `step_contract` 在真实 `contracts-v0.1.0` Git bundle
  上执行：四侧同步，`165 个 schema，匹配 3 个历史 schema`，无破坏性变更，退出 0。
  此检查只覆盖该旧发布 tag；不证明未发布自然语言数组可以继续登记。
- `cargo test --locked -p platform-core --bin platform-core capability_contract::registration_tests`：
  `7 passed; 0 failed`。实现后将 operation 覆盖条件改为永不执行，检查真实
  `FAILED. 0 passed; 1 failed`、退出 101；还原后 7 项通过。
- `cargo test --locked -p contracts --test roundtrip`：3 项通过；
  `go test ./internal/contracts -run Roundtrip -count=1`：通过；
  TS contracts `npm test`：4 项通过；Dart `dart test test/roundtrip_test.dart`：5 项通过。
  在样例中主动删去第一个 step 的 expectedOutputJson，四侧分别退出
  101、1、1、1；Rust 报 missing field，Go 检出多出的空值，TS 检出 undefined
  字段，Dart 报 Null 非 String。还原后四侧全部通过。
- 独占隔离库 `component_vectors_yyrwwt` 上原 `sqlx migrate run`：68 条前进成功；
  `14000` 原 revert → run 均成功。两条独立回滚事务分别放入旧数组/新 envelope，
  原 up/down 分别报 requires an empty contract catalog，psql 都退出 3；断开后
  查询 Catalog 行数 0、成功迁移数 68，未留下脏夹具。夹具只在该独占库事务内
  临时关闭关系 trigger 以构造迁移前置，不用于声称治理准入通过。

未运行本批 full、产品镜像/安装包构建、模型调用或实际组件套件；未写业务库、
未部署。ComponentRelease register/approve/revoke 与 Cells/WeKnora/Wren 集成
不因本批变为完成。

## DD-108 知识库预置契约的真实引导（2026-10-06）

本批补齐原 Catalog bootstrap 的实际消费者：编译固定
`contracts/adapter/knowledge.v1/registration.json`，使用原登记校验器验证五个必选键、
permission、JSON Schema 和有序机器向量，再沿原部署 Principal、ActionExecution、
AuditEvent 及 Catalog 事务安装一次。它不是在线管理员登记或组件批准。

四步影响结论：

1. 权威为 DD-108、DD-88 与 `.design/07` §2.4。只安装 KNOWLEDGE v1；
   FILE_STORAGE/DATA_QUERY 种子、WeKnora 五键 Remote Adapter、真实组件一致性运行、
   release 审批和 binding/model projection 均不因此完成。
2. 原 `platform_bootstrap::ensure` 在确认实际 Catalog/operator 后调用种子消费者；
   同 tenant 行锁和同事务固定类别、版本、摘要与三条审计。种子的
   `registeredByActionExecutionId`、人类批准引用保持缺省，独立
   `bootstrapActionExecutionId` 指向真实部署 AE；不是用部署 AE 冒充人工登记。
   原 Web/Desktop Catalog 共用生成 DTO，Mobile 没有新增管理入口。
3. 重启只比较已有不可变内容，不重写状态；已弃用版本不会复活。已登记不同内容、
   已有类别但缺少 v1、缺 Catalog/operator、错误来源均拒绝。在线登记仍 DRAFT，
   仍需原另一管理员审批；没有新增网络 bootstrap 动作、审批绕行或业务正文副本。
4. `20261007020000` 保留原运行时约束，新增来源互斥与部署 AE 关联约束；下行在
   存在种子时拒绝丢弃不可变证据。空库可上下往返。新客户端继续读取旧人工登记
   格式；旧客户端缺少种子来源语义，不能将新增种子响应宣称为全面向后兼容。
   本批必须与共享客户端同批发布，旧客户端须升级后使用 Catalog 管理页；没有
   给旧客户端伪造人工登记引用，也没有保留第二读路径。此前已发布的纯人工登记
   行格式继续可读，但新增种子行不在旧客户端的兼容承诺内。

实际验证使用既有 4 CPU / 8 GiB SDK 与独占隔离库
`kailo-channel-agent-pg-h8mshl/knowledge_seed_20261006_s1`，没有连接业务数据库。
原 `sqlx migrate run` → `revert` → `run` 均成功。原生产 bootstrap 的事务内验证
覆盖重复启动仅一个 AE/三条审计、跨租户来源拒绝、原人工弃用后不复活；事务最终
回滚，不遗留种子夹具。种子不是伪造 APPROVED release，也未解除原审批人分离。

原始日志目录：
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`。

- `knowledge-seed-generate.log`：原 `tools/gen.sh` 四侧生成退出 0。
- `knowledge-seed-roundtrip.log`：TS contracts `npm test`，28 项通过；后续 Dart
  因未设置原缓存路径而失败。改为原 `/cache/pub` 后，
  `knowledge-seed-roundtrip-restored.log` 中 Dart 23、Rust 23 通过，Go contracts 包退出 0。
- `knowledge-seed-core-verified.log`：原 Core registration 10 项通过，包含真实隔离
  数据库调用；随后 Clippy 报新增 tuple 复杂度，已改为实际 SQL row 结构。
  `knowledge-seed-clippy-restored.log` 中 Clippy `-D warnings` 退出 0。
- `knowledge-seed-ui-restored.log`：共享 Catalog 18 项通过，源码和测试 tsc 已通过。
  首轮 Vitest 旧 CLI 参数不兼容的输出保留于 `knowledge-seed-ui.log`。
- 实现后 SDK-only 将 search 的 consume 改为 read，实际权限映射断言失败，退出
  101（`knowledge-seed-core-mutation.log`）；移除共享页面种子来源消费分支后，新
  种子页面用例真实失败，退出 1（`knowledge-seed-ui-mutation.log`）。两处均从正式
  源码逐字还原并 `cmp` 退出 0；`knowledge-seed-final-restored.log` 最终 Core
  10/10、Clippy `-D warnings` 0、共享页面 18/18，命令总退出 0。
- 原 `tools/check.sh` 的兼容比较段实际执行：相对 `contracts-v0.1.0`，242 个
  schema 中匹配 3 个历史 schema，无破坏性变更；该旧 tag 不包含本次 Catalog
  view，不能用此结果宣称旧客户端能够消费种子响应。

本批未执行产品镜像构建、部署、真实模型调用、五键业务套件或全量检查；现有
WeKnora 后端已部署的事实与此源码批分开记录，不能把种子安装验证当成组件接通。

## 原生引用进入能力实参（2026-10-06）

权威：沿 DD-102/108 与 design03 ContentReference 单一引用语义，修正原种子
读/导出/删除的空对象输入 schema 与 HUMAN ComponentActionInput 实际输入不一致。
输入 schema 直接复用 `contracts/domain/content_reference.schema.json` 的完整文档，
不新增类型，不把业务正文写入 Core/Temporal。种子尚未部署，本次不改已有 Catalog
行、不修改历史迁移校验和，不生成 release/binding 或假原生对象标识。

影响：原注册向量 `referenceFromStepKey` 仍只能指向同 case 更早的相同 Resource/
Asset；注册时其 inputJson 必须是空对象占位，不能覆盖任意用户参数。实际派发时将
前一步原生响应的 typed ContentReference 同时送入 inputJson 和原 typed 槽，按当前
冻结契约的 inputSchemaDigest 重新验证后才签发令牌；最终报告按同一逻辑复算摘要。
普通静态输入仍在注册时校验。本次只对齐 Web/Desktop HUMAN、Agent Tool 与独立
adapter 所需的文档引用数据形状，不证明整个派发协议已相同；Mobile 不新增组件
宿主页面。没有四侧 wire schema 或数据库变更。

副作用及异常：缺失/跨 Resource/Asset/错误原生版本/非空覆盖输入、未知契约键和
实际 schema 不匹配均沿原 PRECONDITION 拒绝；原生读取权限仍由已有双相 PEP 决定。
重入使用原 idempotencyKey，UNKNOWN 对账仍只查询原执行，不重放 execute。注册时
的延期校验不算真实套件成功，报告也不凭 resultJson 推断引用，不产生第二引用权威。

实现后在既有 4 CPU/8 GiB SDK 跑原 component_release 与 capability_contract 模块：
分别 10 项通过、2 项显式忽略，以及 10 项通过、1 项显式忽略。SDK 删除 inputJson
物化语句后，原 probe 实参断言确实得到空对象而非引用，退出 101；已从正式字节还原。
首次回拷保留旧 mtime，Cargo 没有重编译、仍执行变异产物，恢复检查失败；随后核对
文件摘要、纠正本次三个 SDK 投递文件归属并更新时间，再重编译，保留全部原始输出。
日志位于 Data 的 `codex-agent-receipt-regression-20261005.XvkUjX/`
`profile-settings-ortsoo.DRR20F/typed-reference-input*.log`。

范围未完成项：ingest 的原生预置文档引用、发布/索引终态与删除清理证据仍需独立
adapter 原生消费者闭合。此处没有伪造 fixture native ID/revision，也不把整个五键
套件、组件完整集成或部署记为通过；全量检查与真实发布另行记录。

同批交叉复核又确认独立的既有派发缺口：`component_release::prewrite` 的套件请求
仍是 `contractKey/inputJson`，而 `application_binding_native::Adapter::execute_prepared`
实际生产请求是 `actionKey/arguments`；Worker 不转换这些字节。隔离签发器的请求
摘要及身份字段也尚未等效于该生产消费者。因此本次 typed input 修正不能解除
Remote Adapter 套件接通阻断，不能把隔离通过当作真实 read/export 通过；不会在
Adapter 添加另一条只为套件通过的执行或鉴权路径。原生独立服务开发与平台协作
主线继续，不因这一组件接缝停工。
