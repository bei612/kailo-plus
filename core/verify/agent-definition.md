# AgentDefinition 与 Resource owner 实现核验

## 本批固定树全量收口

实现与负向恢复完成后，原 `tools/check.sh --full` 对固定树
`641f5cf0ef5d8a0e33515739303b33cff7b2f49b` 实际退出 0。
原件 `bOjEqV/full.log` SHA-256
`888d3185ba0019361836c9c280fe6dbaeb341f599835f4eac0d9564ffc1a288f`。
121 schema、四侧生成与兼容、真实数据库前进/回退/再前进、SQLx、44 项
命名枚举约束、workspace 检查、replay、18 条追溯与供应链均通过。
实际 `.env` 预检 SKIP；Catalog bootstrap、approval CAN 与 Relay outage
三项 ignored；内置 secret 扫描无命中但未安装 gitleaks。外部集成早返不算
业务验收，Desktop 旧 h2 构建失败与 Mobile keystore 缺失仍属于该冻结树的
发布边界。独立新 Win11 包不反改此回执；后追加证据只运行原文档快路径。

## 2026-10-02 22:40 UTC 本批 Automation 管理与原生回复检查

Automation 已沿原治理入口实现五项管理命令及 BFF 列表/详情，共享 TS 管理页和
Mobile 只读页复用同一生成合同。权威是 REQ-23、DD-107、设计 05 §2.9；本刀
不新增 Schedule/Webhook/手动运行，不更换 Temporal，不建立第二份 Registry。
新准入只消费 ENABLED 与当前 pin；已准入 Invocation 在 PAUSED/DISABLED 下
消费原冻结版本、Installation、Grant 和 generation，真实撤权或代际变化仍拒绝。
首 turn 的空 native-turn 阶段与 completed reply 的确切 turn/固定 event ID 阶段
互斥；每次外部查证后按真实数据库时钟复读已锁 Grant，不借锁冻结到期时刻。
Resource/Asset 及失败创建的同 AE、两 native 删除证明和完整空关系集归属已有
生命周期；管理读取不执行 quota、health 或对账。写者为原 Core，读取者为生成
TS/Dart 合同；50th 迁移原回退/再前进退出 0，当前无旧在线 writer 或历史数据
兼容窗口，不新增旧读链。Core 不复制协作正文，UNKNOWN 不渲染成功或失败。

实现之后追加的六项 Automation 检查实际基线和最终均为 6/6，SDK 退出 0。
其中真实 PostgreSQL EXPLAIN 核查原 RUN/FROZEN 查询与原锁目标，直接消费原
SQL 谓词核查 240 个准入/在途组合和 720 个首 turn/回复阶段组合；独立库无
业务行，不能将这些检查称为真实运行。逐次破坏 MENTION 字段、线程唯一目标、
显式确认、Version 正数、暂停后在途状态和 exact native-turn fence，六次均
编译成功后指定断言失败（Cargo/SDK 101，原启动 wrapper 1）。每次立即恢复
`automation.rs` SHA-256
`2ecd1e2cf6d48211ffa461944bea8088a5fa374aa74dfe193e44dce37ea0320b`；
最终 `automation-evidence-restored.log` SHA-256
`c4d8d6c2625793705a51882800a6ff59dfc85f9144e5b9d4c22a20a0cf6975b1`。
原件在 `/volumes/data/kailo/tmp/codex-automation-integration-20261002.bOjEqV/`，
六个 `automation-mutation-*.log` 均保留，不以 wrapper 的退出码改写 Cargo 结果。
初轮接线中途编译缺少 publish_reply 的 101 和未投递 DESIGN 时 registry 生成
拒绝均保留；它们不是预期反例。冻结实现后检查通过；registry 使用真实相邻
设计路径再次生成退出 0，没有修改产品以迎合私有目录投递错误。

原生回复的三项 Task 与一项 Bridge 后实现检查基线、最终都实际退出 0。
未知/缺失 phase、未来 completedAt、固定签名时间三次变异分别触发原指定断言
失败（Cargo/docker-exec 101），逐次 SHA 还原再通过；最终日志
`/volumes/data/kailo/tmp/codex-task-bridge-mutations-20261002.iPZsYz/final.log`
SHA-256 `7b4698aba11c0fa00f38b73721228a0b7b38bd40626745ccf4bbdbea00d93784`。
Task 恢复 SHA `0d9ed40379ade47bb5fc10c92c9f973da33d321de497a5e8a068a80c92c9d9bb`，
Bridge 恢复 SHA `3f2d4a0801ed785c1ed6b5f313c655eab50504a8b3701f8a576be1d44ad21452`。
初轮实际 SDK 指出的弃用 as_u64 已机械改为原 API as_secs，最终检查无该警告；
本次唯一持久修正只在原检查的一行。初次 TMPDIR 拒绝、基线及变异引入的警告
均保留，不能把容器编排进程清理退出码 137 当作检查退出码或 OOM。
资源复用不可变 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
与已有 4 CPU/8 GiB、Data 缓存，实际检查 OOM 为零，没有宿主工具链或新 checker。

共享 UI 三消费者类型及原 98 项检查、Mobile 原 25 项与四文件 analyze 均通过；
Thread→CHANNEL 分别被真实 TypeScript/Dart 工具拒绝，精确还原后再通过。
完整原件与失败/还原边界见现有 Web/Mobile 核验记录。本节不证明真实
Codex→Relay 回复、完整 billing、Memory 写入、通用 replyPolicy、模型 Route
产出方、公开 Installation/Grant、Win11 安装、三端或生产部署已经完成。

## 2026-10-02 本批 Agent 原生回复生产者：已实现、业务尚未验收

本节记录私有候选 `bOjEqV/apps` 的最新实现；下文历史检查只覆盖各自当时
冻结范围，不验证本节新增回复代码。本批沿用 REQ-03/06/23、DD-37/47/48/107、
`09` §3、`12` §6、`17` §7/10 与 `19` 的正文及引用边界，没有新增动作、
ReplyPolicy 语义、审批权威、Workflow 或公开运行入口。

### 四步影响与实现事实

1. 权威与原生依据：固定 Codex 提交
   `7498521d288b9b3b96ffba4eedf089d8d6e06a84` 的
   `codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs::Turn`、
   `codex-rs/app-server-protocol/src/protocol/v2/item.rs::ThreadItem::AgentMessage` 与
   `codex-rs/protocol/src/models.rs::MessagePhase` 提供 full items、原生完成时间
   和封闭的 `commentary`/`final_answer`。`native_reply` 要求 completed、完整
   items、唯一非空 final、确定且合法的原生时间；任何 AgentMessage 的未知或
   缺失 phase、异步 delivery/questions、重复 final 均拒绝，不以另一个 final
   掩盖未知事实。AutomationVersion 已冻结的 `TRIGGER_THREAD` 是本刀唯一结果
   目标；仅支持消息/@提及触发，不解释任意 `AgentVersion.replyPolicy` 字符串。
2. 调用与准入：已有 `AgentTask.advance -> observe` 在同 Invocation/native
   thread/turn/clientId 关联和 completed 事实下调用真实生产者。两次事务均
   核同 AE、Tenant/Workspace、Installation、pin Version、projection generation、
   AGENT 身份与原 Temporal Activity；复用 `automation::fresh_reply` 同一准入
   实现，分别消费未冻结回复和已冻结确切 event ID，并在外发前重验当前
   Grant/scope/权限/Quota。没有复用首 turn 的 null-turn 准入绕过回复条件。
3. 副作用与证据：复用 collab-bridge 的原 OpenBao AGENT 代签、原 Relay
   publish/query。固定 Buzz 提交 `779af8886caae1317b4de962082429867ab61503`
   的 `crates/buzz-relay/src/api/bridge.rs::submit_event` 与
   `crates/buzz-core/src/nip10.rs::ThreadMarkers::resolve` 是接受和 root/source
   取证接缝。kind 9 的时间取原生 completedAt，root/source 取冻结 Invocation；
   先持久固定 event ID 和原 operation 的 AGENT DISPATCH，再且仅在当前请求
   外发已签 event。确认必须包含同一 event ID；原生查询须证明单一确切 ID、
   AGENT 作者、签名、Channel 和 root/source。Core 仅存引用与类型化审计元数据，
   不保存输出正文、签名完整 event 或复制 Codex/Relay 历史。
4. 幂等、取消与终态：每次外发前重查同 Temporal Activity、cancel 和固定意图。
   已有 event ID 的后续观察只查原 ID；崩溃或发送结果不明不重签、不生成新 ID、
   不重跑 turn/model。原生 accepted/HTTP 202 都不是 Invocation 终态；缺确切
   Relay 证明保持 UNKNOWN。即使回复已查证，完整 billing completeness 未闭合
   仍保留 BILLING_UNAVAILABLE，不写 Invocation COMPLETED，不伪造计费成功。

### 本批检查事实与未验收边界

已在实现之后追加三项 Task 原函数断言和现有 Bridge 检查中的一项离线签名
断言：完整 final/原生时间、未知或缺 phase、重复 final/异步消息，以及固定
时间/正文/root/source 的 kind 9 ID。三个私有 mutation diff 分别破坏 phase
拒绝、未来原生时间拒绝和固定签名时间；只读 apply-check 已通过。本节最初
写入时四项断言和三个变异尚未运行；随后实际运行结果以上方 22:40 UTC 记录
为准。源码窄 `git diff --check` 实际退出 0，不等同真实业务验收。

本刀三条源码与检查路径于 22:23:13 UTC 停写；before、精确窗口差异和三个
mutation diff 位于
`/volumes/data/kailo/tmp/codex-agent-native-reply-before-20261002.6MWGhs/`。
没有执行真实 Codex turn→Relay 回复端到端、Win11/三端运行或生产部署；完整
bill commit、Memory 读写与结果暴露验收、通用 replyPolicy 投递、llm_route
治理 producer 均不由本刀宣称已交付。Installation ready/ACTIVE 与全部运行
链仍须各自事实闭合；本节不是 Stage 5 完成或公开入口开放证明。

## 2026-10-02 实现范围与权威

本批是 Stage 5 的首个 Core 平台 Resource 实现，不是 Buzz Desktop 本地
Agent 存储的服务端化。权威为 `.design/03` §4、Agent 实体段、`05` §2.8、
`10` 审批与撤权，以及 `DD-24/25/45/47/99/100`。

已写入的链路是 `agent.definition.create/update`、同 Tenant 的 BFF 列表与详情、
`resource.transfer_owner`，及其必需的成员撤权与 Tenant 销毁衔接。Definition
只保存设计的五个字段；Core Resource 的 native ID 是自身 ID、无 application
binding、无 home Workspace。没有建立 Asset、Version、Installation、模型路由、
运行时或另一套 Agent 注册表。未发布的 version pointer 保持空。

所有写入复用既有 Governance、ActionExecution、幂等键、审批和审计事务。
创建和投影前先持久化 Resource 与同一个 ActionExecution 引用；原生
SpiceDB 写入结果不明时，保存同一 AE 的 UNKNOWN 与审计，由既有治理对账器
对账，不分配新请求或工作流。投影未闭合时不开放 Resource 读写。

owner 转移按现有 SYNC 动作与另一位 Tenant admin 的审批执行，owner 必须为
同 Tenant 的 active HUMAN。创建、转入与撤权共用 Tenant、Principal 和
TenantMembership 行锁；REVOKING 成员在实际 Resource owner 转出前不能进入
REVOKED，Tenant 销毁方向除外。未创建应用 Resource 或 Asset 时不虚构对象。

Tenant 删除冻结真实 Resource owner/version；审批 fresh 校验同一冻结对象、
当前 Core owner、成员资格及 SpiceDB relationship。销毁按冻结对象逐一删除
SpiceDB 关系并回读为空，随后将 Core Resource/Definition 留为不可用墓碑，
不删除 ActionExecution、审批和审计事实。

## 结果不明与终态证据复核

`agent_definition::dispatch` 对已有 desired 投影的恢复是对已发生副作用的
对账，不是重发；终态仍要求 FullyConsistent 权限读取的非空 ZedToken，并写入
既有终态审计。原生 read/check/write 失败均保存 UNKNOWN，不能以 SQL 回滚
把已经发出的请求重新描述为尚未派发。

取消创建时复用现有原生删除：只有删除 progress 为 COMPLETE、关系回读为空
且修订引用非空，才清除投影意图并进入 ABORTED。转移失效则恢复 Core 冻结的
旧 owner 投影并回读完全相等；未查证时仍为 UNKNOWN。旧 SpiceDB `check`
只接受 HAS_PERMISSION 与 NO_PERMISSION，CONDITIONAL 和未知枚举返回
Unavailable，不作为确定拒绝或成功。

## 实际镜像内检查

使用已有不可变 SDK `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。
执行前检查活跃构建及压力；容器内核回读 CPU 2、memory 8 GiB、swap 0，
Cargo 并行度未降低，派生缓存只在 `/volumes/data`。

- `tools/gen.sh` 四侧生成实际退出 0；没有手写生成类型。
- 首次 Core check 的两处 identity 字段引用错误已改为实际
  `tenant_principal_id`，不是增加身份回退。
- 两次 clippy 原始退出 101 引用了旧 SecretStore metadata。容器内源文件
  SHA-256 `08d895104a97bebaf7a63c6632b4ab1a2e264231f19212f6970ea04aa98904a6`
  与实际工程相同，PlatformKey、owns_platform_key、delete_tenant 符号均存在。
  仅清理该包的派生缓存后，workspace clippy 退出 0；未改 SecretStore 源码。
- 同一容器 `cargo test --manifest-path core/Cargo.toml --workspace` 退出 0：
  106 passed、3 ignored。未提供 DATABASE_URL 的既有集成检查会早返，
  不将其计为新 AgentDefinition、owner 转移或删除的业务正向验收。

本地原始证据目录为
`/volumes/data/kailo/agent-definition-sdk-20261002.gSgpJt`，包含四侧生成、
原编译失败、容器内源 SHA/符号及 `core-clean-secret-clippy-test.log`。
首次 `gen-registry.py` 因 SDK 未挂载设计目录退出 1，未绕过该要求。

### 全新隔离库与契约检查

随后使用 Compose 已固定的 PostgreSQL 镜像
`sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`
建立本批独立空库。数据库名和用户取自已有部署配置，随机凭据经 Docker
受控 stdin 投递，不打印、不进入 argv；仅发布回环随机端口。PG 限额为
CPU 2、memory 1 GiB、memory+swap 1 GiB；检查 SDK 为 CPU 2、memory 8 GiB、
内核 swap 0。未连接或修改本地业务数据库。

仅调用原 `tools/check.sh` 的 `step_migrate`、`step_contract`、`step_trace`
和原文档检查，不改其实现，以实际 FAIL 变量退出；这不是 `--full`。
SQLx 与 Cargo 在 SDK PATH 中存在，DATABASE_URL 非空，库在迁移前的
catalog 表数为 0。最终整次窄检查退出 0，原始日志为上述目录的
`fresh-scope-tcp-migrate-contract-trace-docs.log`：

- 39 条迁移，包含 `20261002010000_agent_definition`；前进、回退、再前进
  三步 PASS，没有将 migrate SKIP 计为通过。
- `cargo sqlx prepare --check --workspace` PASS；40 个命名枚举约束与
  `contracts/enums/` 逐值相等。
- 四侧生成物同步 PASS；相对 `contracts-v0.1.0` 无破坏性变更，检查
  90 个 schema、匹配 3 个历史 schema。
- 18 条追溯与注册表校验 PASS，文档完整检查退出 0。
- 迁移后 Resource 与 AgentDefinition 行数均为 0；只核对已有三条真实
  ActionDefinition 已由迁移登记，没有创建业务样例。

Go、TypeScript、Dart 的既有 round-trip 随后另在相同固定 SDK 执行，CPU 2、
memory 4 GiB、内核 swap 0，生产源码只读、独立 Data 缓存、网络关闭。
Dart 只复制现有文件至 Data、离线取得依赖，没有新增样例或测试。
`three-sides-roundtrip.log` 记录 Go `internal/contracts` 通过、TypeScript
类型检查与 1 项 round-trip 通过、Dart 2 项既有检查通过；整次退出 0。
加上前述 Rust workspace 中的既有 round-trip，四侧已有双向序列化检查均
通过。这些既有 canary 检查不是新 AgentDefinition 对象的业务正向验收。

### 失败、纠正与清理

原错误未改写为通过：

- 首个临时 PG 因 sudo 环境隔离未取得密码而启动失败；随后改为官方
  stdin 环境投递，没有启用 trust 或放宽认证。
- 原检查 main 的依赖准备因 pnpm 非 TTY 拒绝清理 modules 而退出 2，
  迁移未运行；记录在 `fresh-migrate-contract-trace-docs.log`。
- 首次直接 source 原检查函数时，原脚本顶层的 `$0` 相对目录使工作目录
  错落 `/workspace`，迁移和契约 SKIP、追溯 FAIL，实际退出 1；记录在
  `fresh-scope-migrate-contract-trace-docs.log`。纠正执行目录后重新核验，
  未改生产检查。
- 一次 PG 初始化期间的 socket readiness 误判临时启动实例已就绪，SDK
  连接中断，实际退出 2；记录在
  `fresh-scope-corrected-migrate-contract-trace-docs.log`。最终只在真正 TCP
  readiness 成立后执行迁移。
- 本轮部分 SDK 默认以 root 写共享 Rust 派生缓存，造成正常 pre-push 的
  Permission denied；这是执行归属错误，不是产品源码问题。批次负责人
  仅修复该项目 Rust 缓存的归属。后续共享缓存容器必须显式使用 launcher
  当前 UID:GID，不能默认 root；本记录不把正在重试的 push 写成成功。

本 lane 自有 SDK 与临时 PG 容器均已精确删除，并确认 Docker inspect 不再
找到它们；其他服务和业务库未动。原始日志、before 差异、临时 PG 数据目录
与契约副本仍保留于 Data，不声称这些磁盘数据也已清理。本刀逐文件差异为
该证据目录的 `owned-window.diff`，用于区分继承改动，不代替提交边界复核。

## 影响门禁与发布边界

本批编辑前使用 c478169a 时点的同一原生 schema-4 current 图谱。
SpiceDB read 的 CRITICAL、write 与 Params 的 HIGH 已在编辑前告警；
动态 BFF/构造/新文件 UNKNOWN 用实际源码消费与同 Tenant scope 核对补证，
不解释为零风险。PDG 有界结果和原始失败均保留。原图不证明新代码完整覆盖，
提交前统一刷新与 detect 由批次负责人完成。

当前 `agent.definition_management` 的 exposure 为 none，runtime routes/actions
为空，现有注册表闸门不生成用户入口。没有部署这一 Core 切片、没有新增
测试业务对象或夹具，也没有真实浏览器/API 的创建→审批→转移→撤权→删除
端到端验收。现有编译与迁移证据不替代这些业务验收或 Stage 5 退出门禁。

## 2026-10-02 原生增量契约登记纠偏

随后发现平台原生 `agent.definition` 的 `incremental_contracts` 仍为空数组。
本刀只纠正这条已存在消费者的登记：迁移登记完整的
`NATIVE_INTERNAL` / `NATIVE` 契约，说明稳定键、修订、删除、对账触发和
readiness 语义；数据库拒绝空登记。`agent_definition::prewrite` 在原有类型
登记检查中同时要求该原生契约存在，不建立另一套准入或注册权威。
没有改 Resource owner、审批、派发或投影逻辑，也没有创建 Version、
LLMRoute、RuntimeProfile 或运行时入口。

编辑前使用 e4c544fd 时点的原生 current 图谱；`prewrite` 的 HIGH（7 个受影响
符号，直接调用方 `Governance::allow_in_tx`）已明确告警。迁移和新领域文件
UNKNOWN 由真实 SQLx 迁移入口、治理调用和模块注册补证，不记为零风险。
原始影响记录为
`/volumes/data/kailo/tmp/codex-agent-prerequisite-impact-20261002.R3Od8p.log`。
本刀写入之后图谱自然落后；该前置记录不替代最终提交门禁。

### 实际检查与反向证据

使用同一不可变 SDK、显式 UID:GID `1000:1000`、CPU 2、memory 8 GiB、
内核 swap 0 和 Data 缓存。临时 PostgreSQL 使用前述固定镜像，CPU 2、
memory 1 GiB，仅回环随机端口，未使用业务数据库。原检查函数及原 Cargo
命令没有修改，也没有新增测试、样例或夹具。

- `migrate-registration-final.log`：原 `step_migrate` 前进、回退、再前进 PASS；
  包含本次纠正后的 39 条迁移，SQLx 离线数据同步 PASS、40 个命名枚举约束
  PASS；真实登记读取为 `1|NATIVE_INTERNAL|NATIVE`。
- `migrate-registration-raw-prepare.log`：在该隔离库事务内把登记改为 `[]`，
  原约束确实报错，退出 1；只把真实登记的 role 改为其它既定值时，同一
  生产 JSONPath 准入谓词返回 `f`，回滚后返回 `t`。未保留被破坏的登记。
- `contracts-cache-clippy-final.log`：`cargo fmt --manifest-path core/Cargo.toml
  --all --check` 与 `cargo clippy --manifest-path core/Cargo.toml -p platform-core
  --offline -- -D warnings` 实际退出 0，整次 `sdk_terminal=0`。
- 工程与 SDK 副本的 `agent_definition.rs` SHA-256 都为
  `c0153938e6a8de78b8f30f415b9e85fae37ea53b3718d17d0b39ec9cdb03e9dd`，
  迁移都为 `a8259f72b616949a1cbb38a0eea9f1d3e3c41ed18b7a9cc3538cd8725c53a338`。
  最终 SDK 和该次 PG 容器已经精确删除，Docker inspect 确认不存在；日志与
  本 lane 的 Data 副本保留，未清理其他缓存或服务。

本次原始日志均在
`/volumes/data/kailo/agent-prerequisite-sdk-20261002.4isiSf`。原失败保留：
首次 shell 引号错误在启动容器前退出 2；随后一次 sudo 环境隔离导致
DATABASE_URL 未投递，迁移 SKIP，不算通过；私有源码副本漏实际注册表导致
SQLx 编译失败，补入原文件而非合成配置后才通过；首次 fmt 漏原命令的
`--all` 退出 1。后续 clippy 退出 101 指向旧 contracts 派生产物：容器内
当前源确实含 `PlatformSessionAccessMode` 并与工程 SHA 相同，随后只执行
`cargo clean -p contracts`，删除该包的 132 个派生文件后检查通过，未改类型
或放宽检查。第一次清理 launcher 因 SDK 不含 `rg` 在执行清理前退出 127，
之后仅将只读符号诊断改用已安装的 `grep`，没有安装或修改 SDK。

这些结果只证明本次登记与生产准入判据纠偏，不是 AgentDefinition 业务
端到端、AgentVersion 发布、模型调用或运行时验收，也不是 `--full` 通过。

## 2026-10-02 派发前 Tenant ACTIVE 谓词纠偏

本刀关联 `DD-96`、`.design/03` 的 Tenant 状态与 `06` §7.2：暂停首先
停止组件投影与 Resource/Asset 创建。原 `roles::lock_tenant` 只读取行存在性，
不能作为 `agent_definition::dispatch` 的 Tenant ACTIVE 事实。

派发现直接锁定同一 Tenant 行并读取 `state = 'ACTIVE'`，缺失行按 false
处理；AE → Tenant → Resource 的锁序不变。非 ACTIVE 不完成成功投影，
仍复用原 `abort_projection` 恢复冻结 owner 或删除创建投影，原生结果未查证
时保持 UNKNOWN。不改公共 helper、准入权威、API/schema 或关闭入口。

编辑前原生 upstream impact 为 LOW，6 个受影响符号，直接调用方为
`Governance::dispatch_inner`；原始退出 0 的记录为
`/volumes/data/kailo/tmp/codex-agent-dispatch-impact-20261002.log`。
本刀没有新增测试或夹具；格式、静态检查与原 SDK 验证由批次负责人集中
执行，此记录时尚未取得本刀验证结果，不复用此前结果宣称通过或业务验收。

随后本刀进入固定树 `254e071fe529f565bb854e4483390c1087f5ef7e`，原
`tools/check.sh --full` 在不可变 SDK、4 CPU、8 GiB、swap 0 下实际退出 0；
包含格式、静态检查、四侧既有验证、契约兼容、replay、追溯与文档门禁。
原日志为 `/volumes/data/kailo/tmp/codex-core-functional-closure-254e-full-20261002.37trEJ.log`。
未投递 DATABASE_URL 与 `.env`，迁移演练和真实部署预检均 SKIP；此前
37 迁移隔离库证据属于修正前源码，不能当作本刀数据库通过。未取得
暂停 Tenant 派发分支的业务运行证据，尚未提交、正式构建或部署。

## 2026-10-02 11:53 UTC AgentVersion 契约生成事实

AgentVersion/Asset 的契约、迁移与治理/投影处理器源码已写入；冻结的 16 个
输入文件在生成前后摘要一致。原 `tools/gen.sh` 在不可变 SDK 镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`、
实际 4 CPU/8 GiB、无额外 swap 的容器中产出 Rust、Go、TypeScript、Dart
契约；`GEN_ATTACH_EXIT=0`、`GEN_CONTAINER_EXIT=0`，六项生成物摘要回读一致，
其中两项既有 i18n 输出字节未改变。未手写共享类型或新增生成入口。

原始日志为 `/volumes/data/kailo/tmp/codex-agent-version-generated-20261002.YBWlJF/gen.log`，
SHA-256 为 `8db2b7eaec12d4d98a98a0963e56b36f5dd8d42a6fb7f73f0fac9c062e86c5fa`；
输入冻结清单为
`/volumes/data/kailo/tmp/codex-agent-version-owned-before-20261002.2jUk6e/source-frozen.sha256`。
本项只证明源生成，不是 AgentVersion 的集成编译、迁移、双向序列化与兼容
验证或业务验收。owner/成员撤权与 Tenant 删除等实际消费方尚未收口，
RuntimeProfile/llm_route 实际目录事实尚缺，公开入口保持关闭；未提交或部署，
不复用前文 `254e071f…` 的 full 宣称本增量通过。

## 2026-10-02 12:32 UTC AgentVersion 消费链实现增量

本节记录实现后的事实，不是新增规格。依据 `DD-24/25/45/47`、领域模型
`03` 与 Agent 管理 `17`：Version 是已有 Definition 下的 Asset，owner 是
active HUMAN；本批没有创建第二注册表、额度或审批权威，也没有安装或启动 Agent。

写入前已对全部实际目标完成原生 context/upstream impact，原件为
`/volumes/data/kailo/tmp/codex-agent-version-consumer-impact-20261002-resolved.jsonl`，
实际退出 0。索引根是 apps，固定 HEAD `8ec78ed4…`、runner schema 4，
官方 status 与 typed context 的身份相同且 incomplete reasons 为空。
owner 校验 CRITICAL，冻结清单、审批输入与 BFF 资格 HIGH 已在编辑前告警。
部分入口的 impact 为 UNKNOWN 或 lower-bound；真实 BFF/service 路由、Worker
CoreAPI 和 SQL/map 消费由源码补证，不把零入边或没有流程输出当作没有调用。
原生索引本身报告流程预算与部分语言覆盖缺失，不能声称全工程图谱审查完整。

三个队友分别写入 Definition/SpiceDB、成员撤权、邀请准入消费；负责人写入
治理/BFF/Tenant 删除和 Version 派发复核。准确变化为：

- Definition 查询真实 published pointer；不再固定返回 None。
- 冻结 Resource 与 Asset 的实际 owner/version，任一 pending projection 拒绝；
  重核双方状态、active HUMAN/TenantMembership、父 Resource 与两类原生投影。
- 既有快照分别持久化两类引用；审批输入、fresh 资格和 BFF 生命周期身份
  都消费这两类引用。未知 targetType、重复引用与版本冲突不转为授权。
- 成员最终撤权同事务核对 Resource/Asset owner 和未收敛投影，保留 Tenant
  销毁例外与原 409/503、会话撤销、版本及审计行为。
- 邀请准入仅补新 Params 的三个 None，不创建 Asset、Version 或新业务动作。
- Tenant 删除沿原生 SpiceDB 删除完成、非空 revision 与空集合回读，纳入
  冻结 Asset；真实外部证据齐全后，先清 Definition pointer，再将 Version
  退役、Asset/Resource 墓碑化，保留历史 FK、Operation、Usage 与 Audit。
- Version 派发重新读取父 Resource owner 的 ACTIVE 事实，不以投影命中代替
  身份与成员状态；无法查证仍 fail closed，UNKNOWN 不渲染为成功或失败。

锁与事务仍归既有 ActionExecution/Tenant/Resource/Asset，未改 Workflow type
或终态证据权威。ActionCommand 新字段可选，历史空 Asset 快照数组仍可读取；
新共享类型来自 contracts 原生成器。当前没有旧版在线 writer，历史数据迁移
兼容窗口无适用对象；新迁移非空 Asset 时确定停止回退，不能静默丢弃版本权威。
三端管理面仍一律经 BFF，Web/Desktop 不新增两套实现，Mobile 不增加写入口。

本记录时各实际源码 diffcheck 退出 0，正在选择排除独立 CHECK/NIP-11 的集成
输入；本批尚无 SDK、迁移、业务闭环、提交、release 或部署通过声明。前文
原 full 和原四侧生成均只证明各自记录的输入，不能替代本次消费者的验收。
没有新增测试、夹具、检查脚本或伪 ACTIVE RuntimeProfile/llm_route；目录事实
缺失仍拒绝，Installation、Codex turn、工具用量、记忆与自动化仍未交付。

## 2026-10-02 12:45 UTC 集成编译接线纠正

本批选定输入重新运行原 `tools/gen.sh` 与格式化，实际退出均为 0；
随后原 clippy 实际退出 101，发现三处接线错误：两个消费者错误地使用
顶层 `AgentVersionContent`，实际 ActionCommand/View 引用生成类型
`ContentClass`；Version 消费的既有冻结目标版本方法未开放 crate 可见性。
原失败保留于
`/volumes/data/kailo/tmp/codex-agent-version-gen-clippy-20261002.gxu8tq/verify.log`。

实现只改为消费真正的生成引用类型，并让冻结版本方法为 `pub(crate)`；
未手改生成物、复制结构、变更契约含义或放宽授权。选定输入与正式代码
同样修正，原全量检查与独立空库检查随后集中重跑，结果单独登记。

## 2026-10-02 12:58 UTC 集成与空库结果

本批原 `tools/check.sh --full` 实际退出 1，完整原件为
`/volumes/data/kailo/tmp/codex-agent-version-selected-full-20261002.wPL3eW/full.log`，
SHA-256 `73cbf77b6de1afd7b15f12962c3e1b01920a9012bb46b294e487dec2ca11869d`。
格式、clippy、Go vet、TypeScript/Dart 静态检查、四侧已有验证、history replay、
四侧生成同步、108 个 schema 与三份历史契约兼容、文档与静态安全检查均通过。
已有双向序列化 canary 不覆盖新增 Version 业务 payload，不把它写成业务验收。

失败分列，不改成通过：追溯误将 S1/S2 的 `DD-45/47` 写成 S5 归属，现移除
这两个归属项，仍在本记录保留它们的共用治理依据；检查输入未挂载既有
Core/Worker dist 证明；新契约的 Web/Win11 实际输入与旧 artifact 来源不符。
另有 launcher 全局 Git 环境污染只读上游的仓库选择，不能据该失败宣称
上游 commit 缺失。后续用原入口纠正 Git/dist 投递，并正式重建受影响产物，
不修改门禁、源码摘要或断言绕过。实际 `.env`、gitleaks 与 Mobile 签名边界
仍按原输出保留；尚无新增提交、正式 Core/Worker release 或业务部署。

独立空库原 `tools/check.sh migrate` 实际退出 0：38 条迁移已应用，含
`20261002110000` AgentVersion；前进、末条回退、再前进与 workspace SQLx
离线核对通过，41 项命名枚举约束与契约逐值相等。没有旧在线 writer，
没有创建测试业务对象。原件为
`/volumes/data/kailo/tmp/codex-agent-version-fresh-db-20261002.MOuD6a/original-migrate.log`，
SHA-256 `ce1446caba578f51708bb765db50132a06cd3f12e70f4ff1208bc01d2e406683`。

迁移后的附加只读计数命令有 shell 引号错误，使外层 SDK 容器退出 1，
不是原迁移失败；失败原文保留。仅重取计数，原生 psql 实际退出 0，
Resource、AgentDefinition、Asset、AgentVersion 行数均为 0；原件为同目录
`post-migrate-facts-retry.log`，SHA-256
`fc2d93116f91e52efcadcaa7c13ab4978675cbf5347646ecdbb5ee9dcd5212b2`。
SDK 与 PG、唯一网络均已精确清理，Data 原件保留，不声称磁盘数据已删除。

## 2026-10-02 13:30 UTC 后实现图谱与 Web 产物事实

图谱原生 worker 崩溃和不被支持的 `--workers 0` 失败原件均保留。
使用同一固定 runner 的受支持 `--workers 1` 重试，实际退出 0；源码根与
Git 根均为 `/volumes/kailo/apps`，没有升级、修改工具或索引外层工作区。
原件 `codex-agent-version-final-worker1-graph-20261002.log` 位于 Data 临时目录，
SHA-256 `830f97a5ecd59f6b1f37880d975f2a57fca29366ecee2551089a798f754e6b5c`。
随后原 status 与 typed context 核得 HEAD `8ec78ed4…`、runner schema 4、
身份 current、content drift current、incomplete reasons 为空。

后实现原 explain/PDG 查询定位 Version 派发、冻结 owner 与 BFF 资格。
Version 文件 controls 返回全部 194 条；flows 首次只返回 200/278 条，
断言实际失败，原失败保留，没有当作干净结果。随后通过原只读 Cypher
枚举该文件的实际变量，用原 pdg_query 的 variable 参数逐项查询 63 个
变量，全部结果无截断、计数合计精确为 278；三处 owner/资格目标查询也
未截断。完整原件为
`/volumes/data/kailo/tmp/codex-agent-version-post-implementation-pdg-partitioned-20261002.jsonl`，
SHA-256 `de9f27a2503a5c60e3b9f99a0a8e9f87d6b9e2885cf0c6e2ce29c23b71b37706`。
没有上调上限、修改引擎或豁免 PDG 截断。零 taint finding 不证明没有风险；
原生流程预算、动态调用与语言覆盖缺失仍保留，不称全工程安全审查完整。

共享生成合同实际改变 Web 构建输入，原 Web helper 已完成构建、registry
push 和原 record，实际退出 0；source `e01a495e…`、artifact `0f5039d6…`。
Compose、13 份既有追溯与 upstream 的真实引用已经同步，完整依据见
[Web 核验](../../web-client/fork/verify/web-surface.md) 本日增量。
本条记录时 Win11 同源重建仍在原 helper 中，不冒称已产生新包。新 Web 未部署；
本批仍未提交或取得最终 full/detect，通过源码检查不等于新增业务验收。

## 2026-10-02 13:52 UTC 客户端来源收敛

随后原 Win11 helper 已真实退出 1：Tauri Windows 打包在下载
`https://index.crates.io/2/h2` 时发生网络低速超时，尚未产出新安装包，
没有执行成功的 Desktop record。历史 `9aef4725…` 包不属于当前
`9255e0e8…` 源码，不能把旧包重新标为新来源。

当前 Desktop 来源登记按已有 manifest 的缺产物状态撤回，原失败日志、
旧包与历史来源证据保留，具体原文见
[Desktop 记录](../../collaboration/fork/verify/desktop-client.md)。
这没有修改验证工具、构建输入、依赖或运行语义，也不解除 Win11 发布
与安装验收；本批实现继续收口，Windows 缺包不再被隐瞒或用于无限等待。

## 2026-10-02 14:01 UTC 最终集成收口

最终选定树 `7de76d450c4b54086a79841cf9a866a9c13aeaf2` 在同一不可变
SDK 镜像内实际运行原 `tools/check.sh --full`，`FULL_EXIT=0`，外层 SDK
和 attach 均退出 0；20 个选定源码和四侧生成物的 SHA-256 逐项核对一致。
源码、Git 与检查范围均为独立 apps，正常只读 Git 投递使固定上游基准
真实可解析，没有修改验证工具、缩减来源或使用全局 Git 变量影响证据。

原日志：
`/volumes/data/kailo/tmp/codex-agent-version-selected-final-full-20261002.BkGKqU/full.log`，
SHA-256 `460b33a9b62c5217523c7dcee7b99c6785dc138dff542854c248265b5fbcd366`。
格式/静态检查、四侧既有验证、108 schema 与 3 份历史契约兼容、replay、
17 条追溯、文档及现有安全不变式全部通过。full 内没有提供 DATABASE_URL
和实际部署 `.env`，两项明确 SKIP；独立空库迁移/SQLx/41 约束的实际
结果以上述各自日志为准。内置 secret 扫描通过，但未安装 gitleaks。

Desktop 当前来源为 blocked/none，Mobile 缺 release 签名，原输出明确
记录两端阻断；分端门禁通过不解除这些发布条件。新 Web 产物未部署，
Core/Worker 未由本树构建部署，Agent 公开入口和新增业务场景未验收；
没有改变能力状态或将检查通过写成生产就绪。此前失败与旧产物证据保留。

## 2026-10-02 16:35 UTC Definition-only 共享客户端增量

本次直接消费已经实现的 Definition 管理链，不增加 Agent 注册权威、API、
数据库对象或运行策略。依据 `.design/17` §6–8 与 `DD-24/25/45`，稳定定义、
版本发布、Workspace 安装及运行授权是不同准入点；定义创建/显示名更新不需要
启动 runtime。`resource.transfer_owner` 仍按 `.design/05` §2.8 走既有审批，
Core 的目标查询通过 `catalog.agent_definition` 限定真实 Resource。

既有追溯记录只登记 Definition 列表/详情与 Version 的三条只读 BFF 路由，以及
`agent.definition.create`、`agent.definition.update`、`resource.transfer_owner`
三个已有动作。BFF 的 `exposed_route` 已有实际消费，不另建路由；没有登记
Version 写动作、删除、Installation、Invocation、Skill、Tool 或模型管理入口。
能力目录仍须由原 `tools/gen-registry.py` 生成，不手写生成物。

Web 与 Desktop 都挂载 `client-kit/ts/platform/src/react/agents.tsx` 的同一份
`AgentDefinitionsPage`；宿主只接既有导航、图标与内容分支。Desktop 的
`PLATFORM_SECTIONS` 改为直接引用共享导航目录，不再维护第二份枚举。
共享客户端从生成的 Definition/Page/Version 与 ActionCommand/Submission
契约读取字段；没有改契约或手写第二份领域类型。列表/详情读取失败不是空列表，
未知状态或不完整 Resource 事实不显示为就绪；当前 published pointer 的 Version
读取每次仍由 BFF 执行 fresh read 与父 Resource/Asset 投影核对。

写表单复用现有语义色、Button/Table、useLoad、幂等键、Task 状态解读和
writeFailure 规则。核对面板冻结实际读取的 Resource ID/version 与命令；创建
仅写稳定标识/显示名，更新仅写显示名，owner 转移仅引用新的 HUMAN Principal。
权限、成员资格、审批、Quota/Capacity 与版本冲突仍由 Core 重查。
网络结果不明、派发 UNKNOWN、EVALUATING 或尚未派发的 ALLOWED 不渲染为
成功/失败，不取消冻结意图，只允许以同一幂等键重查原请求；列表翻页或刷新不
卸载此意图。已登记回应只展示 Operation/ActionExecution 引用，并指向既有
Tasks/Approvals 查证，页面重入时也读取本人仍在进行的定义任务。

所有新增文案进入共享 `en/zh-CN` 消息表，继承宿主主题；未新增 Mobile 组件宿主
或写界面。新增共享文案的 Dart 投影仍需原生成入口集中生成；不手改生成物。

本刀改前字节与精确差异存于
`/volumes/data/kailo/tmp/codex-definition-ui-window-20261002.BS2o8R/`。
源码检索已核对两真实宿主、BFF、治理参数、原 ACTIVE ActionDefinition 与审批
目录；GitNexus 按用户当前要求暂停。已运行选定已跟踪路径的 `git diff --check`，
退出 0；新增文件的 no-index 检查无空白错误输出，其差异退出码不作为编译通过。
没有运行 SDK、类型检查、React/浏览器验证、注册表生成、文案生成、构建、
业务端点演练或部署；这些由主线在实际选定输入上集中执行。

当前追溯记录仍为 `in_progress`，release gate 保持
`blocked_until_seams_closed`，没有借旧 Web/Desktop 或 Core 摘要冒充本刀产物。
exposure 的源码登记不等于当前运行版本已开放；须原生成、实际新来源产物与
端点验证收口后才能发布。此前空库、full 通过及入口关闭的历史记录均保留，
不改记为本次业务验收；本刀未提交、未 push、未部署，不宣称 Stage 5 完成。

### 2026-10-02 16:56 UTC 同窗口消费纠偏

实现后复核发现原表单将任务读取失败当作零条在途请求，而且在途 owner 转移
只有提示，未阻止同一 Resource 的新意图。现已直接修正该判定：原任务读取
pending、失败、未知 gate/dispatch/task 枚举或缺少关联引用时，不准备新请求；
同 Definition ID 的修改/转移仍在进行时必须先查证，创建在途时不另发创建。
这些是客户端防重复交互，不替代 Core 的 fresh 权限、审批和版本核验。
结果不明的原意图仍保留冻结命令与幂等键，只重查原请求；任务与审批仍由
原 BFF 消费，没有新建状态权威或存储层。已有任务可手动刷新查证，不设置
新的超时或自动重发。回应含未知 reason 也视为不明，不展示确定成功/失败。

已登记回应会关闭旧详情，再从实际目录读取新的 owner/version；不在客户端
乐观修改 owner。新的 owner 与旧 owner 相同不准备转移。当前 published
pointer 只接受实际 PUBLISHED Version；读取期间遇到 DRAFT/RETIRED 或不一致
关联时显示读取失败并允许刷新，不把矛盾生命周期渲染成已发布。没有 pointer
仍是合法的“尚无已发布版本”，并非读取失败。未使用的 Draft/Retired 显示分支
和文案已删除，未加入 Version 列表或运行入口。

本次共享新增消息为 34 项。原生成入口为 `python3 tools/gen-registry.py`
及其 `--check`，和 `python3 tools/gen-platform-i18n.py` 及其 `--check`。
后者必须调用 Dart formatter，按禁止宿主工具链的约束，本 lane 未运行生成，
交由主线在已有受限 SDK 中集中执行；无契约改动，不手写四语言类型。
生成产物是否一致、编译和真实端点结果以主线实际日志为准，不提前记通过。

现有 fork manifest 的 source/artifact 摘要只证明其实际构建版本。共享 TS 改动
进入 Web/Desktop 的真实构建输入，registry 改动进入 Core 的 release 输入；
旧摘要不能证明本刀。原 release/build-upstream 入口须实际构建并登记最终来源，
再同步 trace 的产物引用。本刀未填入假摘要或以源码 exposure 代替已部署事实。
原 before 保留，纠偏后精确窗口继续存于同一 Data 证据目录；产品源码于
16:56:54 UTC 停写。选定已跟踪路径 `git diff --check` 再次退出 0，仍没有 SDK、
浏览器/业务正向验收、构建、提交、push 或部署。

### 2026-10-02 17:23 UTC Definition-only 候选实际验证与 Web 构建

本节追加已发生的结果，不覆盖上述写作时尚未执行的历史。唯一输入为
`/volumes/data/kailo/tmp/codex-definition-ui-head-20261002.q85LI1/candidate`，
从 apps HEAD `d994b2e8dab0eb19889720fef0f3cc9763c95dc9` 精确选入上述
Definition-only 11 路径；原私有 tree 为
`8f49dbd1f4cda38902949d1168b29606e4a90166`，生成及既有检查修正后的 tree 为
`5923b19a450bef265d2feedb7c2152a81bb19c58`。这些是输入 tree，不冒称提交。
未选入正式工作树的 Installation、Invocation、Quota 或 Gateway 后续增量。

实际 SDK 为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID/GID 为 1000:1000，镜像内 Node 为 v24.21.0。执行前核查现有构建与
CPU/内存压力；实际 cgroup 为 4 CPU、8 GiB、swap 0，缓存与临时目录均在
Data。没有调用宿主 Node/Dart、执行只读上游或修改检查工具。原 registry
生成及 `--check` 均退出 0，17 条能力、18 个封闭 Workflow kind 校验成立；
原 i18n 生成及 `--check` 均退出 0，Mobile 文案投影与共享 TypeScript 同源。
实际变化只在既有 capability registry 和 Dart platform_text 投影，无 DTO 变更。

共享包类型检查退出 0，原 7 文件 77 项检查通过；Desktop 类型检查退出 0。
首次 Desktop 原完整检查为 2282 项、2281 通过、1 失败，SDK 实际退出 1：
`fontSizePreference.test.mjs` 仍读取已迁走的 Desktop typography 路径，报
`ENOENT`，不是 OOM。实际 Desktop/Web 都已引用共享 typography；因此只把
这份既有检查的读取路径改为真实共享 CSS，没有复制旧 CSS、新增用例或夹具。
续跑该原检查为 9 项通过、退出 0；Web 原 `npm ci`、类型检查与 4 文件 14 项
检查均退出 0，包含 MessageContent 的 5 项既有 SSR。未重复共享检查、生成
或整个 Desktop 检查，不把首次失败改记为完整 Desktop 退出 0。

修正检查后只在 Data 候选将共享 CSS 的真实 rem 投影临时破坏为 `1px`，
同一原检查实际 8 通过、1 失败、退出 1，确实命中 root rem 断言。随后按
原字节还原，CSS SHA-256 恢复为
`a70c922ca8ea648f818bff79fe0c05d65004a1a3d72eab6303d85d49275b24ad`，
同一 SDK/同一检查重新 9 项通过、退出 0。正式 CSS 未写，候选无破坏残留；
只有上述既有检查的一行路径同步入实际实现范围。

原 `tools/build-upstream.sh web-client` 实际退出 0，完成镜像内 tsc/Vite、
OCI load、registry push 与原 record。使用既有 kailo-core-data builder，
实际 8 CPU、16 GiB、swap 0，缓存为 Data 的 buildkit-core-state；发布地址
只来自唯一部署 `.env` 的 REGISTRY_HOST，没有改配方、限额或新建服务。
原 helper 写回 source
`sha256:ef73ee2c0a29dc27746ed6219357ea9f99d862a90afaf38ab9b6dd3f0f3a89db`
及 artifact
`sha256:ad4bcec7044b5ce55a219aff4d37ce35f9e9db2a0025e977d4a71a6ac69b61b0`。
构建报告 npm audit 0；大 chunk 警告完整保留，不上调阈值或伪造来源。

原件均在上述 q85LI1 的 `logs/`：`sdk.log`、`sdk-exit.log`、
`sdk-remaining.log`、`sdk-remaining-exit.log`、`css-negative.log`、
`css-negative-exit.log`、`css-restored.log`、`css-restored-exit.log`、
`web-build.log` 与 `web-build-exit.log`；各实际容器限额另存于同目录。
原 helper 的完整 BuildKit 日志是 `tmp/build-web-client.HAb7Bu.log`。
`web-build.log` SHA-256 为
`8f503754b133d54f6181445dffe4a1e345cad71a86fd58a517c976ead63d9223`。
本 lane 创建的三份 SDK 容器已清理，日志保留；没有清理其他容器或缓存。

既有检查不包含新增 Definition 表单的业务正向、撤权、审批或 UNKNOWN 场景，
不得据类型/SSR/构建称其业务通过。本节没有数据库、真实登录或 BFF 端点演练，
也没有 Win11 包或安装验证；Mobile 没有加入组件宿主。Core release 输入因
registry 变化仍须由主线实际收口；仅新 Web 镜像不证明运行中 BFF 已开放。
本刀尚未执行集中 full、提交、push 或部署，release gate 与 Stage 状态不提升。

### 2026-10-02 17:37 UTC 同一候选集中门禁收口

实际构建之后，Data 候选仅将 Compose 和 13 份既有 trace 的有效 Web
产物指针同步为上述真实 `ad4bcec7…`，Definition 记录也只登记这一实际
Web artifact。未借用 Core/Desktop 旧摘要，仍保留 `in_progress` 与
`blocked_until_seams_closed`；历史验证正文中的旧摘要不全局替换。
原 `upstream_manifest.resolve/source_digest` 重算仍等于已登记的
`ef73ee2c…`，这些配置/追溯变动未改变 Web 构建输入，不重复构建。

最终业务及登记输入 tree 为
`67fc8e3d10582473578aad67e619dd5b68262193`，29 路径，逐项字节校验一致。
在同一不可变 SDK、4 CPU/8 GiB/swap 0、Cargo 并行度 16、Data 缓存与
host network 下，执行未修改的原 `tools/check.sh --full`，实际退出 0，
attach 退出 0、无 OOM。源码只来自该 tree 的独立导出，不含正式脏工作树。
应用 Git 和只读上游 Git 各自解析，不执行 `.references` 中的程序。

首次 full 因 SDK 全局 Git 环境误投递，将只读上游查询也指向 apps 对象库，
错误报告 Codex 基准不可解析。实际中止退出 137、无 OOM；它不是完整
full 通过，也不能据此认为固定上游 commit 缺失。没有修改门禁或产品源码，
修正投递后仅在启动前的单条命令解析私有 tree，进入原 full 前清除全局 Git
变量；正常只读 Git 投递的完整重跑退出 0。两次原日志均保留。

最终格式/静态检查、四侧生成与已有测试、108 schema 与 3 份历史契约兼容、
Workflow replay、设计文档、17 份追溯/18 种 Workflow kind、18 份既有
产物元数据、6 份上游来源和 4 份当前来源产物、安全不变式及 runbook 均通过。
没有 DATABASE_URL，实际迁移演练和 SQLx 在线核对明确 SKIP；没有实际部署
`.env`，运行配置预检明确 SKIP；未安装 gitleaks，只通过现有内置扫描。
原输出保留 Windows 无当前包和 Mobile 缺 release 签名的阻断，不能用该
full 退出 0 解除两端发布条件或替代 Definition 新业务场景验收。

原件仍在上述 q85LI1 `logs/`：首次 `full.log`、`full-exit.log`；最终
`full-corrected.log`、`full-corrected-exit.log`、`full-corrected-limits.log`，
以及 `full-container-terminal-states.log`。最终完整日志 SHA-256 为
`f7b8d9fded928f17dc7d42c4ac09077f8dfae21f0c57bb6ae8bf6c8749e56b58`。
full 所验证的完整补丁、29 路径与字节表分别保留为 q85LI1 下的
`full-verified-window.patch`、`full-verified-owned-paths.txt`、
`full-verified-selected.sha256`。之后只追加本节事实记录，不改变已验证源码
或产物输入；提交、push、Core 发布和部署由主线另行收口。

### 2026-10-02 17:48 UTC 阶段提交与远端核对

上述 29 路径已提交为 `91a5eb2e779593ea8cfb38e10ec6c04886f88138`，
提交树为 `aa7ea2602e557e38380117ff1560efadd62e88ee`。普通
`git push origin main` 实际退出 0，远端 main 从 `d994b2e8…` 更新至
`91a5eb2e…`；随后 `git ls-remote --heads origin main` 回读同一完整 commit。
追加事实记录后的原 `tools/check-docs.sh` 对提交树退出 0，日志为
`/volumes/data/kailo/tmp/tmp.jEJlwE0JCa.check.log`。没有触发 pre-push
全量检查、额外构建或部署。本次提交不包含仍在开发的 Installation、
Capacity、Session、Memory 或 Gateway 增量，不能外推其验收结果。

## 2026-10-02 18:12 UTC Installation 与原生 Memory 消费事实

本节只追加已经写入的消费链，不把前述 Definition-only 提交的 full 或 Web
构建结果外推到本批。依据为 `DD-25/50/66/67/72/99`、`.design/03` §7、
`.design/17` §6–7、`.design/19` §3–4/§8 与 `SS-BUZ-ENGRAM`；适用场景为
`V-SCN-23/59`，这里只记录实现，未将这两个业务场景记为通过。

### 已有 Installation 意图与激活消费

`agent_installation.rs::target/prewrite/start/create_projection/initialize`
复用 Resource、ActionExecution 和 `ComponentTaskWorkflow(kind=AGENT_INSTALLATION)`。
创建固定实际 Workspace、Definition Resource/version 与 PUBLISHED Version
Asset/version，Resource 的责任 owner 是 ACTIVE HUMAN；独立 AGENT Principal、
Buzz identity、DISABLED Channel binding 与 PENDING runtime generation 均属于
同一安装，不从 HUMAN WorkspaceMembership 推断 Agent 授权。
`20261002190000_agent_installation_create.up.sql` 登记的管理创建动作明确为
`capacity=NONE、quota=NONE、meters=[]`，不因此开放 Codex 回合或模型用量。

AGENT 密钥写入前已有持久 Resource projection ActionExecution。现有
`read_or_write_provision_key` 使用固定 Tenant locator 与 CAS=0 后回读，
不为结果不明另分配 locator 或 pubkey。`create_projection` 在原 Tenant/
Workspace/ActionExecution 事务中绑定同 Tenant CONTROL counterparty，调用
`agent_memory::reconcile`；返回 false 时仍提交真实 ERROR/UNKNOWN 观测，
不投影 Channel roster 或把失败当作空记忆。Memory 成立后才对账 SpiceDB
Resource/workspace 关系、fresh discover 与真实 Relay/Channel roster。

`initialize` 对原 PROVISIONING/PENDING 意图先核原管理准入、实际 Workflow
启动事实与 fresh HUMAN 权限，再消费 `model_route::provision`、审计就绪的
SecretStore 读取和 Supervisor `ensure`/原生配置回读。ACTIVE 同代恢复使用
原模型 binding，不制造新代。原网络调用后的 snapshot、Tenant/Workspace、
发起者/owner 成员行锁、授权与 projection generation 再次核对后，才可在
同一事务 CAS 激活 Resource、Installation、runtime projection 与 Channel
binding。原生初始化只证明实际加载的字段；`verify_projection` 不把缺少策略
消费者的 RuntimeProfile 内容全部标成 effective。缺事实继续保持非就绪。

### SS-BUZ-ENGRAM 的真实读边

上游基准重新以只读 Git 核验为完整 commit
`779af8886caae1317b4de962082429867ab61503`。可解析来源是该 Buzz 仓库中的
`crates/buzz-core/src/engram.rs::{conversation_key,d_tag,validate_and_decrypt,select_head,NIP44_PLAINTEXT_MAX}`、
`crates/buzz-acp/src/relay.rs::RestClient::query_raw_all` 与
`crates/buzz-acp/src/engram_fetch.rs::{fetch_core_body,decode_core_body}`；实际
证据目录为 `/volumes/kailo/.references/buzz`。没有执行其中的程序。

新 `collab-bridge/src/memory.rs::Reader` 直接依赖 apps 中的同源 `buzz-core`，
不复制加解密、slug/HMAC 或 head 算法。CONTROL 用现有 NIP-98 读取同一
Installation AGENT/counterparty pair；fresh NIP-11 给出页上界，原复合
`until/before_id` 游标走到末尾才 COMPLETE。完整页序、重复 ID、签名、
原生 envelope、解密和完整 plaintext bytes 任一不成立均拒绝；恰到 listing
上界仍作一条探测，超过上界是 BOUND_EXCEEDED，不伪装为完整空集合。
head 选择保留原生 timestamp/event ID 规则，不改写未来 head 或迁移 ciphertext。

`platform-core/src/agent_memory.rs::{Config::from_env,reconcile,read_core}`
消费既有 AgentMemoryBinding。Config 三项上界均必填且无源码默认值；body
还受上游导出的 NIP-44 上界约束。binding 查询锁定实际 Tenant/Workspace、
HUMAN owner/成员、AGENT、CONTROL 与原 Memory 行；PROVISIONING 只允许原
同 scope ALLOWED 创建意图及已启动的 AGENT_INSTALLATION Workflow。
双 SecretRef 的 locator/version/audience/pubkey、audit gate 和当前 Relay
NIP-11 snapshot 均实际重验，缺失不回退共享身份。成功枚举产生
COMPLETE/CONSISTENT/ACTIVE；超前 head 产生 HEAD_AHEAD_OF_RELAY/ERROR；
不可查证为 UNKNOWN/ERROR，确定撤销为 REVOKED。只 CAS 写 binding/head
引用和观测状态，原生明文不进入数据库、审计、history 或错误字符串。

新 Session 读取函数区分实际 Found、确认空集合 Absent 与原生不可读 None；
身份、scope、secret 或 projection 失效仍是拒绝，不降为 Absent。当前
`agent_session.rs` 已有真实调用点，但此记录不把正在集成的 Session 持久 pin、
首轮 memory context、恢复或用量链声称为已验收。Memory 写入、core 审批、
cold 工具和 Memory 管理入口不在本刀实现范围，`V-SCN-60` 未验收。

Memory 四个实际路径于 17:55:48 UTC 停写，原 before/after 字节在
`/volumes/data/kailo/tmp/codex-agent-memory-before-20261002.9KfWj4/`。
两新模块 SHA-256 分别为
`a03a9f534eb0048d5d544f2c30c6c2bcb61c5208d9b9a1a8dca146cace20330a`
与 `4594188d4e69c92dca45c1cb1438cec8f7496ec75c7e88f1431bdec49f8fc598`。
其余两条仅为 collab-bridge 现有 Cargo path dependency 与 lib module export；
继承的 `limits` export 不算本刀。`git diff --check` 实际退出 0；本 lane
没有启动 SDK、生成、格式化、编译、真实记忆/安装演练或部署。主线集中
SDK 的后续结果单独记录；目前未提交或 Git push，不宣布 Stage 5 完成。

### 2026-10-02 19:14 UTC 集中消费者批次证据

以下是上述实现之后的冻结批记录，不把正在开发的下一批混入验收。

- 权威：沿用 DD-47/48/65/66/67/70/71 与 SS-COD-CONFIG、SS-BUZ-ENGRAM；
  Core 只存平台治理事实与 thread/head/lease 等引用，不复制记忆或消息正文。
  AgentTask 使用 Temporal 的原 Workflow/Activity，不另建执行权威。
- 影响：安装 ActionExecution/ComponentTask、AGENT 身份/Memory binding、
  runtime projection、Session、Invocation 消费和 CapacityLease 共用原事务与
  scope；Worker 的 heartbeat/attempt/run input 和四侧生成物一并冻结。
  全新空库没有旧 writer，历史数据兼容无适用对象；公开动作仍只有已有
  Definition 管理及 Version 读取，不开放安装或执行。Web/Desktop 使用同一 TS。
- 副作用：Session 先落 STARTING 再 thread/start，结果不明只查证原引用；
  已知 thread 不是已派发 turn。Capacity 回收同时消费原生与 Temporal 终态，
  观测超时或缺证据不释放单位。原生 Memory 超前 head 在 inspect/read 两边拒绝，
  不改写为 Absent；Gateway 缺用量关联不推进非空输入游标。
- 边界：重复 Activity 只续同 run/holder/attempt，背压返回等待；取消 accepted、
  空 history、部分投影和上游未知状态不构成业务成功或失败。撤权后的安全收尾
  不发起新 turn；四项未有真实策略消费者的运行字段仍不可 active。
  DENIED/BLOCKED/PRECONDITION/LIMIT/CONFLICT/UNKNOWN 沿用 06 §4，UNKNOWN 不终结。

冻结目录为 `/volumes/data/kailo/tmp/codex-agent-batch-20261002.UGTzYB`。
`sdk-core-frozen.log` 实际退出 0、OOMKilled=false：SQLx prepare、全目标
clippy 与 Rust 既有检查通过。Worker vet/test、46 条独立空库迁移的前进、
最后一条回退与重进记录在同目录前序日志；这不是实际部署库或新增业务验收。
独立 PostgreSQL `catalog-check-restored.log` 位于
`/volumes/data/kailo/tmp/codex-agent-task-catalog-evidence-20261002.fMTAy3`，
SHA-256 为 `e9fca2a9e2e264ff08a7d1a2da74b58a211a2de3c807efe306b753837b683a29`。
实际 48 个约束、三个 scope trigger 和零业务对象；NULL 原生终态、缺双侧终态
引用的 RELEASED 均拒绝。事务内删除实际 Invocation 约束后相同检查确实报
SQLSTATE 23514，ROLLBACK 后原检查再次通过；未留下业务种子或删除实际数据。

首次选定树 `full.log` 实际退出 1，漏选能力注册表、Compose 产物 pin 以及
Web 来源不一致均按真实来源修正。Rust 的真实失败随后由原 lint 输出定位为
空 `CARGO_BUILD_JOBS` 投递；未设置就不传，不调低并行度。最终 full 独立留存，
数据库演练与实际部署配置缺投递时仍 SKIP，不把它们改记 PASS。

本批不包含正在开发的 Delegation、Usage audit/commit 或 Installation 查询。
首轮 Invocation、模型执行/回复、完整计费、记忆写入、自动化与三端业务闭环
仍缺实证，未以编译、HTTP 接受、镜像 push 或健康检查解除发布阻断。

### 2026-10-02 AgentTask 已有 Reply 引用只读消费

此节记录实现后的源代码事实，不是新增 Reply 策略或运行入口。

1. 权威：DD-47/48、03 AgentInvocation 与 12/17/19 的原生引用边界。
   Codex 固定提交 `7498521d288b9b3b96ffba4eedf089d8d6e06a84` 的
   `codex-rs/app-server-protocol/src/protocol/v2/item.rs::ThreadItem::UserMessage`
   给出 `clientId`；现有 `Supervisor::turns` 读取 full items。Task 现在即使
   已持有 turn ID，也要求同一个 turn 内唯一的 Invocation clientId，未知状态、
   缺关联、重复关联或不完整页不构成 native terminal 证据。正文不落 Core。
2. 影响：原 `AgentTask.advance -> observe` 消费持久 `reply_event_id`，
   仅在 native completed 后查证；它不生成 Reply ID、签名、发布或重跑模型。
   原 AE operation 的 AGENT DISPATCH 必须带同 Reply ID、AGENT pubkey 与
   ActionExecution 引用，并与 Tenant、Workspace、安装、pin Version 和
   projection generation 联合核对。任意一条引用缺失都不能称送达。
3. 副作用：`IdentityClient::channel_reply_exists` 使用原认证 `/query`，
   回应必须为单一确切 ID、kind 9、固定 AGENT 作者且原生签名有效。
   Channel 标签唯一；root/parent 使用 apps 同源 `buzz_core::nip10` 解析，
   必须等于 Invocation 的 root/source。查询后再次锁原 Invocation 并核对
   同一 DISPATCH/身份/scope 引用，才追加稳定键的 RECONCILIATION/ACCEPTED；
   审计只继承原引用，不保存消息或 Codex 正文。空查询、身份不可读、回应错误
   或并发引用变化仍待对账，不解释为拒绝、未送达或允许第二次发布。
4. 终态：Reply 观察不制造新授权；撤权后的读取只收尾已有意图。仍沿原
   Capacity native/Temporal 双侧释放，Activity 可结束不等于 Invocation 完成。
   原 Reply ID 未有送达证据保持 UNKNOWN；即使已查证送达，缺 per-turn 用量
   completeness 证据仍为 BILLING_UNAVAILABLE，未写 COMPLETED。

当前 `AgentVersion.replyPolicy` 和 RuntimeProfile 仅能表达策略键集合，没有
已验收的键到 thread/broadcast 原生语义投递。Buzz 固定提交
`779af8886caae1317b4de962082429867ab61503` 的
`crates/buzz-persona/src/resolve.rs::ResolvedPersona` 是两个独立布尔事实
`thread_replies`/`broadcast_replies`，不能擅自映射为 THREAD 默认值。
没有合法 Reply 发布路径时仍 CAPABILITY_BLOCKED；本刀未添加没有调用方的
正文解析或发布方法，也未把 `replyPolicy` 记作 effective。

实现窗口的原始三文件 before 位于
`/volumes/data/kailo/tmp/codex-agent-reply-owned-before-20261002.AiUi6Y/`。
本 lane 只运行源差异与 `git diff --check`（实际 0）；没有执行 SDK、格式化、
编译、数据库、真实 Relay Reply、Codex turn 或端到端演练，也没有图谱、
提交、部署或 push。新发布、合法 Invocation producer、完整计费与
RuntimeProfile 投递仍未验收，不因本只读消费者宣称 Agent 运行交付完成。

### 2026-10-02 原生首 turn 与两类实际用量的集中集成

此记录产生于实现之后，不重定义已有自动化或计量合同。

- 权威：DD-47/48/107、05 §2.9 与 03 §8。自动化 owner 是 HUMAN，实际 actor
  是已 pin Installation 的 AGENT；模型 token 只来自 durable Gateway，运行次数只来自
  唯一查证的原生 turn。复核 OpenMeter 完整 commit
  `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af` 的
  `openmeter/meter/parse.go::ParseEvent`：COUNT 原生计为一，不读取 value property；
  `api/v3/handlers/meters/convert.go::ToAPIMeterAggregation` 与
  `api/v3/openapi.yaml::MeterAggregation` 的 API 值是 `count/sum`。
- 影响：原 Supervisor 的 `turn/start`、Task 的 CREATED 消费、Session 冻结 Memory
  引用、Automation Relay producer、同一 AE/Delegation/CHECK/Capacity、原 trace/usage
  outbox 与审计查证。Web/Desktop 只用共源 Installation GET，Mobile 只读管理。
  未发布迁移尚无旧 writer、原私有空库无模型 trace/usage，历史兼容无适用对象；
  回退拒绝有持久 trace/usage 的库，不删除真实使用记录。
- 副作用：写前派发意图先提交，AE→Tenant→Invocation 锁序下在原 guard 内 fresh，
  不另开锁自身的事务。冻结 Automation template 与临时触发正文分别成为原生 text
  input，不发明插值，不把正文写入 Core、审计或 Temporal history。
  同一 native meter 集合精确分离 automation count 与模型 token sum，CHECK 仍检查
  全部已登记 meter，不删计数 meter 绕过限制。
- 终结与异常：缺授权、binding、native startedAt、meter 或终态证据仍拒绝或 UNKNOWN。
  `AGENT_INVOCATION` 的稳定 ID/time/body 与已查证 native turn 绑定；模型事件继续
  使用原生 durable seq/ID。二者共用唯一 outbox 与已有治理周期，202 只 ACCEPTED，
  精确事件 stored_at 才 COMMITTED；投递不明保持原 ID 对账，告警归原用量 runbook。
  未有 per-turn 全集完成证据时不宣称完整计费或 Invocation COMPLETED。
  错误仍用 06 §4 六分类，撤权、重入、未知状态和恢复无连续 activity 事实不降级成功。

共享 UI 选定树实际 98 项通过；scope、Version pin、generation 三次私有破坏均有
断言失败，逐次还原后 9 项通过。原始 `ui-final.log` 位于
`/volumes/data/kailo/tmp/codex-agent-next-batch-20261002.reqvgM/`，SDK 退出 0。
前两次错误按钮 label 的失败输出保留；无关既有 theme 检查不混入本批。
这只是管理面呈现证据，不代替浏览器、Win11、Mobile 签名或 Agent 业务闭环。

### 2026-10-02 20:43 UTC 同批纠偏与实际输出

并行复核在实现后确认并直接修正四个可达问题：触发 HUMAN 与 owner 不同时的
成员撤权竞态；Session/Capacity 持 DB fence 等 Process 与旧派发反向持锁的循环；
Process 等待跨过 Grant/lease 期限；Workflow 已关闭而 native turn 已存在时的运行
计数漏消费。现在都是原 AE→Tenant→Invocation/成员 fence→Process，同一事务
在 idle-read 后重验；CHECK HTTP 后用 `clock_timestamp()` 再读真实 Grant/lease。
同一原 Usage 对账只读查证 fixed thread/turn、唯一 Invocation clientId 与 native
startedAt，补同一稳定 count/outbox；不改 Invocation 业务终态或重发 turn。

`agent_model_trace.invocation_meter_projection` 原 CHECK 对缺 key 的 `{}` 会得
SQL NULL、被 PostgreSQL 接受，已改为整体 `IS TRUE`。这是同一未发布迁移的
fail-closed 修正，不新增状态、历史窗口或第二 meter。原私有空库末三条迁移
实际回退/重进，49 条到 `20261002230000`；Agent Session/Invocation/lease 均零行。
复用原 catalog 检查核对 25 个实际 CHECK 标量边界，主动移除新 meter CHECK 后
报 SQLSTATE 23514，ROLLBACK 后原检查再次通过。没有向业务表插入假对象。

本批原件均位于 `codex-agent-next-batch-20261002.reqvgM`：

| 原件 | 实际结果 | SHA-256 |
|---|---|---|
| `sdk-final.log` | SQLx prepare、clippy、workspace 退出 0；两种 policy/runtime 变异各断言失败、按 SHA 还原且原检查通过；SDK 0 | `0d3d07c3f723d33e7faf8a28f9de816119d09626f36d94712dfa8356da91c9c0` |
| `ui-final.log` | 98 项通过；scope/pin/generation 变异各断言失败，还原后 9 项通过；SDK 0 | `bdf8288829be42d7fe4d56a9515fa9ac4bee2b729ad3767d475c366d65a5f26f` |
| `mobile-sdk-mutations.log` | 原固定 Flutter 3.41.7 镜像、非 root；12 项与四种实际变异/还原，SDK 0 | `2dbd52695a3ff189badbe438bc1692324fb657482bb0423432a3b0a431487008` |
| `web-build.log` | 原 Web helper、registry push 0，真实 artifact `13841511…`/source `28eb2fd4…` | `178009db3097f525c6ff531d2f08322a8b0d07da221e6c51017006696d8b86b1` |

DB 的 `db-final.log` 与 `catalog-final.log` 保留完整原输出。Core 初轮实际失败包括
未读字段/大 tuple、`url` 未导入及旧 Refusal 显示/类型接线，均修正实现而非压掉
warning；原错误留在 `sdk-integrated-restored.log` 等文件。Mobile 初轮原镜像
权限失败和第一次变异错误 cwd 的日志保留，最终执行的是非 root 私有缓存与
apps 根下 apply；不以工具失败冒充断言抓错。

当前仍无新 Web 部署或 Codex/Relay/OpenMeter 全链真实业务验收。模型 Route
的原生 Hybrid ConfigResource 能力已亲核固定
`1f7ebbf87cbdbe9517f6f181221879d04dc50692` 的
`crates/agentgateway/src/ui.rs::upsert_config_resources` 与
`crates/agentgateway/src/config_store.rs::ConfigResourceStore::upsert_prepared`；
阻断不是上游不支持，而是设计 03 §7、05 §2.8、17 的 `TENANT_ONLY` 模型管理
尚未冻结 Action/审批/配置输入归属，不能借应用 `resource.create` 改义。
工具治理、回复策略投递、Memory 写入、Automation 管理与完整计费仍未交付。
这些缺口不把本批检查通过改写成一期或 18 项目标全部通过，也不阻塞其他已定
功能独立开发；原 runtime artifact 由另一队友唯一构建，不重复启动。

### 2026-10-02 阶段全量收口

选定树 `9c18676a5b49e95a9647a06b77bee2e0eb8e3bf2` 实际运行原
`tools/check.sh --full`，退出码 0，输出末行 `全部通过。`。
原件 `full-restored.log` 的 SHA-256 为
`95daa606a86434c66f569989d11c7ab4c3bddff6bfbf0ea2460057331c5935d9`。
117 个 schema、四侧生成/序列化与兼容、既有检查、Temporal replay、18 条追溯、
18 个供应链产物、6 份上游来源/4 个当前源产物、28 个服务静态边界实际通过。

初轮 `full.log` 退出 1，原件摘要
`31f6159afd3da71481d4350d1672c9c1ec6a3d494cd640329e955c5307b2296b`：
AutomationRun 不是冻结实体、DD-99 不归 S5、13 份既有 Web 追溯还指旧产物。
实体/DD 与产物登记按原权威改正，没有修改领域代码或重复 Web 构建。
初轮真实失败不抹除；第二轮与最后文档快路径单列。

full 内实际数据库演练因未提供 DATABASE_URL 明确 SKIP；前述私有空库 49 条迁移
与实际 SQL 边界证据另列，不能称为业务运行演练。实际 `.env` 预检也 SKIP，
内置 secret 扫描未安装 gitleaks；Win11 当前包与 Mobile 签名缺口仍是 NOTE。
最后新增的这段证据与根入口说明仅经原 `check-docs.sh` 文档快路径复核，
不外推成全工作树、下一批 Automation 五动作、部署或一期生产验收。
