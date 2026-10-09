# 模型提供方认证与原生回复策略接入证据

本记录对应已实现的 NEXT 源码，不代表线上 Installation 已准入或 Agent 首 turn 已完成。
权威为 DD-70/71/110、`.design/17` §9 与 RuntimeProfile 发布合同；不在 Core
复制 Provider/Model 正文，也不另建角色转换、工具、计量或工作流权威。

## 实现与影响

原 ActionCommand 到 ModelRoute 创建、固定源恢复、原生整体投影回读与退役使用
同一封闭认证枚举：新请求必须明确 `NONE` 或 `SECRET_REF`。前者必须没有
`providerSecretRef` 字段，显式 null 同样拒绝；只允许固定 native Custom provider
可核验的无认证配置。后者仍要求同 Tenant 的确切 OpenBao 引用与审计读取。
所有模式都保留 Gateway 入站认证、Installation 专属身份和业务授权。

RuntimeProfile 的可选 `replyPolicyMappings` 显式映射到 Buzz 原生布尔字段，
唯一实际消费者为触发线程回复：thread=true、broadcast=false。缺映射不能借
`replyPolicies` 的字符串获得支持。Version 发布、Installation effective 检查和
回复前的固定 Version/hash 校验消费同一映射；没有另写 Web 或 Desktop 回复路径。
Mobile 仍不承载组件或编辑器。

四侧类型由原 `tools/gen.sh` 生成。原 Dart nullable-list 处理曾把缺省写成空列表，
现于同一生成器按可空声明纠正；缺省保持缺席，不对特定业务字段手写序列化。
旧无映射目录可以解析，但不能执行该回复策略。新增认证枚举为必填，新旧请求的
区别不通过默认值掩盖。2026-10-03 经原 Compose 数据库的只读事务重新核验：
ModelRoute、projection、`llm_route.create` ActionExecution 与无模型扩展的 route
Resource 均为零；本开发环境无旧在线 writer，历史格式兼容无适用对象。
已经删除从缺省模式推断 SECRET_REF 的旧读路径，admission 与冻结意图共用实际
必填模式解析；NONE 的字段存在性同样不能在冻结读取中被 null 擦除。
原件为 `codex-runtime-profile-material-20261003.zaAfD6/live-route-counts-corrected.log`，
退出 0。首次误用 `gate_status` 的查询退出 3，修正为实际 `gate_state` 后重读，
未写库；零对象不等于 Agent 已可用。

持久派发意图先提交，原生结果不明只观察原引用、不重新派发。未知枚举、认证
来源、hash、projection 或终态证据缺失均拒绝/保持 UNKNOWN，不显示成功或零用量。
新 SQL CHECK 使用 `IS TRUE` 防止 NULL 穿透；存在真实 NONE 投影时 down 明确拒绝，
不虚构旧凭据。线上本轮仍为 55 条迁移，NEXT 的隔离迁移证据不替代上线投递。

## 固定上游事实

- AgentGateway `1f7ebbf87cbdbe9517f6f181221879d04dc50692`：
  `crates/agentgateway/src/types/local.rs::LocalLLMParams.api_key` 为 Option，
  `convert_llm_config` 只在 Some 时产生原生 key 认证；
  `crates/agentgateway/src/llm/policy/mod.rs::Policy::apply_final_transformations`
  消费原模型转换，`crates/agentgateway/src/http/apikey.rs::APIKeyAuthentication::apply`
  移除已验证的入站 key。本次复用前在完整 commit 上重新定位了这些路径与符号。
- Buzz `779af8886caae1317b4de962082429867ab61503`：
  `crates/buzz-persona/src/resolve.rs::{ResolvedPersona,resolve_one_persona}`
  提供独立 thread/broadcast 布尔事实，不从一个策略名推测其含义。
- Codex `7498521d288b9b3b96ffba4eedf089d8d6e06a84`：
  `codex-rs/core/src/context/developer_instructions.rs::DeveloperInstructions::role`
  使用 developer。角色兼容由固定 Gateway 的原生模型配置承担，不在 Core 重写请求。

## 已实际运行的实现后证据

使用原 SDK `10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU、8 GiB、swap.max=0、UID 1000，Cargo 请求并行度保持 16；没有宿主 SDK。
这里的 Core 证据只覆盖模型/回复策略冻结快照，不包含审查后新增的 Grant 修复。

| 原入口或真实破坏 | 实际输出 |
|---|---|
| 原生成器及 `--check`，四侧原 roundtrip 与历史契约比对 | 退出 0；142 schemas、3 historical matches |
| 既有四侧入口临时传入两种认证变体，原入口随后精确还原 | Rust/Go/TS/Dart 均 roundtrip 通过；Go string enum 的未知值仍由业务消费者拒绝，不宣称 codec 自带该校验 |
| 删去私有枚举中的 NONE，再调用原生成器和 Dart 入口 | 生成退出 0，实际断言退出 1；精确还原后退出 0 |
| 删除生产 thread/broadcast 守卫 | 实际断言退出 101；原源还原后 4/4 通过 |
| 删除生产 nullable-list 识别并重新生成 | Dart 实际断言退出 1；原生成器/输出还原后通过 |
| 原 Core all-target clippy 和本批格式检查 | 退出 0 |
| 提供方认证、API 字段存在性、原生回复策略检查 | 4/4、2/2、4/4 通过，退出 0 |
| 删除生产提供方认证守卫 | 实际断言退出 101；精确还原后 4/4 通过 |
| 删除生产 API NONE 字段存在性守卫 | 1 passed、1 failed，退出 101；精确 SHA 还原后 2/2 通过、退出 0 |

原件分别在 Data 临时目录 `codex-next-reply-verification-20261003.PBT9w6`、
`codex-next-provider-null-20261003.kstYQ2`、`codex-next-route-closure-sdk-20261003.vgz3dk`。
最后 API 源还原 SHA 为 `3b45bf9a5d19ab614b25b3604c0a474b0ca3059c02ac424ce0bb8811b8d86d7f`。
API SDK 首次 login shell 丢 PATH 退出 127，不算有效破坏验证；改用原镜像 PATH 后
才得到上表的真实断言失败与通过。其他原执行失败保留在对应 handoff，不以新通过覆盖。

当前真实 RuntimeProfile 目录为空，Provider/Model 端点探测不等于受治理 Route、
Version、Installation、回复和 OpenMeter 全链验收。本记录不借之前 CURRENT 的
full 或产物宣称 NEXT 已提交、部署或生产就绪。

## 审查后固定批次的实际结果

原 `./tools/check.sh --full` 对固定树
`e7a2e21266e9c295a1a6dc50558d0d6cf62a8fe1` 实际退出 1。Core clippy、
Core 70 passed / 1 ignored、四侧生成及 142 schema / 3 historical matches；未投递
DATABASE_URL 的数据库检查仍 SKIP，不把早返的测试出口当真实业务通过。
失败包含新检查的 rustfmt 换行、Go 审批消费者残留 `generated.None`，及 Web/
Desktop 共用契约变化后的旧产物 source 摘要失配。原件
`/volumes/data/kailo/tmp/tmp.IPivAXv9rM.check.log`，SHA-256
`af6cb48cb6ca3889ef9294960199d7a97c66a256580d98c9db5135a9e997f2a7`。

实际消费修正为 `generated.ApprovalOwnerRequirementNONE`：3 处 Workflow 与
1 处原夹具，仍是相同的 NONE wire 值，不增加 GetVersion 或变更历史指令。
镜像内 `go vet ./...`、`go test ./...`、`go test ./replay-tests/...` 均退出 0，
OOMKilled=false；原件 `codex-core-review-closure-20261003.D5tn06/`
`go-restored-with-contracts.log`，SHA-256
`b51d05b05be79bce03239c76bb78f7022495060c2c7034c2f7c1c7676b72facc`。
首次复验只挂 Worker 而遗漏原契约样例，退出 1，日志保留，不算源码回归。
rustfmt 换行已按原 SDK 输出修改；完整批次仍未重新通过，不借窄检查消除
尚未真实重建的客户端产物或真实 Installation 全链缺口。

原 Gateway 配置现在使用 Hybrid 保留原生 ConfigResource revision，并有独立
私网模型 listener。入站 apiKey 显式 strict，Bearer 位置与 Core 投影的专属
key/hash/allowedModels 配套；提供方 NONE 不放宽入站认证。实际原生探针
STRICT/无 key 为 401，放宽为 OPTIONAL 时同一拒绝断言退出 1，精确还原后
401/断言 0。原 YAML parser 与原 security 出口为 0，后者实际 `.env` 预检
SKIP；最终 YAML 仅恢复 EOF 空行，不能把该最终 SHA 冒称此前 parser 输入。
原件为 `codex-runtime-profile-material-20261003.zaAfD6/handoff.md`。
候选 RuntimeProfile 保持 DISABLED，live profiles 为空，未借此创建身份、直接
模型调用或宣称 READY。

审查后 Grant 三源的 25 条完整 SQL 已在原唯一 Core 库以只读事务
PREPARE / EXPLAIN (ANALYZE FALSE) 通过，随后 ROLLBACK，退出 0，无写入。
原件 `codex-delegation-revocation-20261003.TZXNsc/sql-readonly/receipt.md`；
这只核验当前迁移下的 SQL 解析与计划，不等于 Temporal/native/计量联合 E2E。

冻结读取的 NONE 字段存在性守卫实际删除后，原五项提供方检查出现
4 passed / 1 failed，退出 101；失败明确是显式 null 被错误接受的断言。
精确还原 ModelRoute SHA-256
`de4e23ebb00bdfc1ef8da8b642c9dc11f5b427a45c0f942fd07a306e9af5827c`
后，同一选定 Core 源的 fmt、all-target Clippy 和原 bin 检查均退出 0，
70 passed / 1 ignored、OOMKilled=false。忽略项要求独立真实核验库，不记通过。
原件 `codex-core-review-closure-20261003.D5tn06/core-restored.log`，SHA-256
`7de7079f90e3777e77c6bead9743385ea33204a48d390910d13e1282f120c5e2`。
首次私有快照缺原 registry include 文件导致编译 101，不算有效破坏；补齐
实际依赖后才得到上述生产守卫反例。源码阶段提交不声明 full 通过或已部署。

## Meter selector 与 hosted search 修复回执（2026-10-03）

本批以 `a80646d4d4ae8632c600e2df860b8c4388b4ae90` 为源码基准，
只合入 OpenMeter selector 与 Runtime ensure 两个已验证窗口，不含正在开发的
Tool、Session 或 Gateway 服务认证。代码两文件 +50/-3；部署未改变。

- 权威：DD-107 的 `automation.run` 为原计数 meter。OpenMeter 固定
  `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af`，
  `openmeter/meter/meter.go::Meter.Validate` 只要求 meter key 非空；
  Feature ResourceKey 的规则不能套到 meter selector。
  Codex 固定 `7498521d288b9b3b96ffba4eedf089d8d6e06a84`，
  `codex-rs/core/src/tools/hosted_spec.rs::create_web_search_tool` 中
  Disabled 不生成 hosted search 工具；此运行期开关已登记于 07 §1。
- 影响：`check_quota`、`turn_meters` 共用正确 selector；Feature/entitlement
  key 仍用原限制。Runtime 写入配置并由 ensure 的实际 config/read 消费者核对。
  不改契约、数据库、Workflow 类型、三端职责或既有状态机。
- 副作用：不创建 meter、Customer、Profile 或 Installation；不产生模型请求。
  禁止 hosted search 绕开 ToolBinding/MCP；其后续工具链不是本批已交付内容。
- 边界：缺失、null、未知值、cached/live/indexed 均拒绝；meter 空 key 拒绝，
  原生 exact key、唯一 ID、Customer/subject/entitlement 前提仍保留。
  失败仍由原调用方映射拒绝或 UNKNOWN，不把外部不明结果改成成功。

固定检查镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；
4 CPU、8 GiB、memory+swap 同额，UID/GID 1000，Data 缓存，Cargo jobs=16。
原 all-target Clippy 退出 0；Meter 1/1、Runtime activity 6/6，最终退出 0。
分别恢复错误 meter 规则、反转 hosted search 生产谓词后，指定断言均实际失败、
退出 101；逐次 SHA/cmp 精确还原，再跑同一目标通过。不是仅编译失败的变异。

原件目录：
`/volumes/data/kailo/tmp/codex-meter-websearch-validation-20261003.lKhNLV`。
最终 `restored-final.log` SHA-256
`96211b4637b2795dd9dd2a31db1a420a336c8023d8df646c5634ab754b808e9b`；
meter 变异日志
`c5e507f8322b7a09488e8a433b4f6c47ea41a497fc6afc20c510f2b2c1773f0f`；
Runtime 变异日志
`5a96b41fdc43cee2df86f0510e3d787bef0894ec6e4e51ee9153a08141fbc5be`。

本批没有运行 full、重新构建镜像、发布、实际 Codex config/read 或 Agent 首 turn，
不据窄检查宣称模型/工具/计量联合验收或生产就绪。

## 已派发且原生 ID 不明的凭据退休拒绝（2026-10-09）

源码基准 `272693d5e1386a352946736c80a2a00ff7c27ff1`。本批只修
`core/crates/platform-core/src/model_route.rs::retire_credentials` 的真实退休
消费者，不重发旧创建、不修改线上意图、租约、线程或 Installation 状态。

1. 权威：DD-48、DD-70 与 `.design/17` §9/§10 要求已派发外部副作用的结果
   不明保持可对账，不能以当前缺失判定旧请求不会晚到。固定 AgentGateway
   `1f7ebbf87cbdbe9517f6f181221879d04dc50692` 的
   `crates/agentgateway/src/config_store.rs::prepare_resource` 在 LlmApiKey
   创建时生成随机 UUID；`crates/agentgateway/src/ui.rs::update_config_resource`
   对不存在的指定 API key 返回 NotFound。相同 metadata/generation 不是原生
   创建幂等键，当前零条目或密钥返回 401 都不能证明旧派发已终结。
2. 影响面：`tenant_delete.rs` 的 Tenant 销毁与 `agent_installation.rs` 的
   旧 generation 退休共用该消费者。`FrozenCredential::retirement_key` 统一选择
   原观察或冻结的精确 ID/revision；已派发且二者均缺失时先返回原 Unavailable，
   不进入删除、absence/401 确认或 SUPERSEDED 写入。已知 ID 的原删除/确认链保留。
   没有新增契约、迁移、状态、Workflow、凭据或三端调用路径。
3. 副作用：不把当前 absence 当 native create 的退休栅栏，不增加第二执行或
   凭据权威。原恢复查询、SecretRef 固定版本和已知响应先持久化规则未变。
   旧 UNKNOWN 保留；本批不能解除目标 Installation 的上线阻断。
4. 边界：未派发且无原生响应仍沿原无 key 路径；精确恢复/冻结响应沿原退休；
   ID/revision 冲突或半对引用按原 TargetStateConflict 拒绝；派发无响应重复调用
   仍拒绝且不改冻结引用。原 Unavailable 映射 UNKNOWN/DependencyUnavailable，
   不新增错误码，不把观察失败渲染成成功或确定失败。

实施后在原模块追加四项检查，覆盖派发不明重入、未派发、精确响应和冲突/半对
引用。实际 `model_route::` 过滤同时命中原 provider 与 application 子模块，
最终为 11 passed、1 ignored、392 filtered out；不能把预估九项当实际计数。
忽略项 `original_projection_refuses_unproved_model_activation_and_drain` 要求
独立迁移库及原 fixture，本批没有运行，不计通过。

原受限 SDK `kailo-client-core-full-fxcd9l`，镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU、8 GiB、memory+swap 同额、UID/GID 1000；Cargo jobs=16、
`CARGO_INCREMENTAL=0`、`CARGO_TARGET_DIR=/cache/rust-target`、`TMPDIR=/tmp`。
执行前宿主 MemAvailable 23 GiB、memory pressure 0；主线 full 已离开 Rust，
只剩 added-lines 扫描，没有并发 Cargo/rustc。将其固定 272693 快照的 core、
collaboration Rust crates/manifest、contracts、registry 与 Gateway proto 实际
依赖机械同步到本 SDK 独立候选，只覆盖正式本批 model_route；checksum dry-run
唯一源差异为该文件，不借旧 SDK 源码宣称当前实现通过。

实际同一命令三次串行执行（不是 workspace/full）：

```sh
cd /workspace/apps/core
cargo test -j16 --offline --locked -p platform-core --bin platform-core model_route:: -- --nocapture
```

- 正向句柄 69028：编译 2m01s，11 passed / 1 ignored，退出 0。
- 私有生产变异句柄 32329：仅将 `retirement_key` 的 dispatched 分支由
  `Err(unavailable())` 改为 `Ok(None)`；编译成功后真实断言
  `dispatched_create_without_native_response_cannot_retire_on_absence` 失败，
  10 passed / 1 failed / 1 ignored，退出 101，不把编译失败冒充负向。
- apply_patch 精确还原后句柄 91574：同一命令编译 1m13s，11 passed / 1 ignored，
  退出 0。正式/候选 cmp 0，源码 SHA-256 均为
  `ccef7a7656db1451b94b6eb36e87ac32fa4dee0c15dec0b0253d005f0fbe3520`。

正式源码 `git diff --check` 为 0；同 SDK stdin
`rustfmt --check --edition 2021` 最终无输出、退出 0。结束时容器只剩原 sleep；
memory.events 的 oom/oom_kill 均为 0，历史 max 计数执行前后均为 776。

日志原件目录：
`/volumes/data/kailo/tmp/codex-client-core-delivery-20261004.fXcD9L/apps/.model-route-retirement-20261009.ifnddu`。
`positive.log` SHA-256
`684f63137cf2ba0214186a5bb130a2fcaa3c55fcce3dbd82612f39654cfcfe3e`；
`negative.log` SHA-256
`4b02ddf9d03b8614cf558be3d1b1ab4d9b3fc721a5abbcfb44d6fb2a98051012`；
`restored.log` SHA-256
`953e66fb3a2ed2574cc2170017f5423beac02b620ed472e7334bc8db4dc0b6c6`。

本批未运行真实 Gateway/数据库退休端到端验收、未部署，也未重放目标旧创建。
主线 full 固定的是原 272693，不包含本次新字节；其结果不能充当本批 full 证据。
