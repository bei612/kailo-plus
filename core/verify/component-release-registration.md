# ComponentRelease 登记接缝证据

本记录只覆盖原登记动作、原组件工作流、隔离 wire 观察、报告落库与授权目录。
REGISTERED 不等于 APPROVED，不证明 ApplicationBinding 或 Cells、WeKnora、Wren 已接入。

Web/Desktop 在同一个 `client-kit/ts/platform` 管理页消费该目录及原 `/api/v1/actions`。
完整 manifest、package 与 binding Schema 经预览确认后原字节提交，不在浏览器重写
大整数或摘要；UNKNOWN 保留原请求和幂等键。目录的 `canRegister` 来自原注册表与
ActionDefinition 策略；未知枚举、缺失字段或 Catalog 无权不显示登记表单。提交后
进入原 TaskDetail 查证，不把 DISPATCHED 当作 REGISTERED，不生成批准/撤销/激活按钮。

## 权威、影响与异常边界

- 权威：`.design/05` §2.6、§2.8 的 `component_release.register` 是 Catalog Tenant
  manage、EXPLICIT、TEMPORAL/COMPONENT_RELEASE、capacity/quota/result NONE；
  `.design/07` §8A 要求隔离环境真实一致性执行。ADR-12/19 固定线协议与受信执行者。
- 影响：原 Action 参数、原 AE 的不可变 plan/report、原 ComponentTaskWorkflow 与
  Catalog release；复用原 SpiceDB fresh check、Temporal current-run 观察、OpenBao
  版本化密钥与审计。三端管理请求仍经 BFF，不新增 Mobile host，不复制业务正文。
- 副作用：候选只来自隔离配置的确切 artifact；每次写尝试 Retry=1，结果不明只按
  同幂等键观察。报告只保存原生引用、终态与摘要；注册与审计共用原事务。被撤权、
  暂停、当前 run 不符、契约漂移、缺 identity/secret/JWKS 均拒绝，不信用户 pass。
- 异常：空/未知/畸形输入 PRECONDITION；当前状态/引用冲突 CONFLICT；scope或权限
  缺失 DENIED；能力前置未满足 BLOCKED；准入背压 LIMIT；控制面不可观测或外部执行未
  确认 UNKNOWN。内部 Refusal::Unavailable 在线上仍映射 UNKNOWN/DEPENDENCY_UNAVAILABLE，
  不是第七种错误分类。UNKNOWN 不转成功/失败，原生终态缺证据不能 REGISTERED。

## 已运行的定向证据（2026-10-04）

执行器为既有 `kailo-installation-scope-sdk-e4agxd`，镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
回读 4 CPU / 8 GiB memory+swap，Cargo jobs=16；Data 私有源及缓存。未构建产品镜像。

- 原 `tools/gen.sh` 与 `--check`：四侧 OK/PASS。
- `go test ./activities ./workflows -run Component -count=1`：两包 OK。
- `cargo test -p platform-core --bin platform-core component_`：8 passed、2 ignored。
  其中本批隔离库目标随后显式执行；另一个旧 workflow scope 目标未在本轮运行。
- 显式隔离库目标 `wire_report_persists_original_release_and_scoped_read`：1 passed。
  消费 Go 实际 HTTP execute/重复 execute/observe 的结果；原生副作用一次，原报告
  原样关联同 AE；错误 run 拒绝且事务不遗留报告；REGISTERED 可按 Catalog scope 读，
  另一 Tenant 读不到；原报告不可改写。所有夹具事务 rollback，SQL trigger 始终启用。
- `cargo clippy -p platform-core --all-targets -- -D warnings`：退出 0。
- `TestComponentConformanceCoreCanonicalBytes`：退出 0；Core 同一 canonical authority
  产出的包含浮点、指数、大整数、负零、嵌套对象和 U+2028/U+2029 的实际请求字节经 Go
  HTTP 客户端保持不变；业务结果摘要消费同一 Core 规范化返回，不手写浮点格式化器。
- 既有 `acbab8036911922c0dad4b4d28c7bb8e13c03afc` 的 69 条迁移（最高
  `20261004015500`）先完整应用到独占隔离库，再写入一个 ACTIVE 夹具租户，随后
  原 `sqlx migrate run` 向前补入 `20261004015000`：退出 0，70 条、最高版本不变，
  夹具租户保留；`component_release.register` 的 ACTIVE ActionDefinition 指向
  `ComponentTaskWorkflow / COMPONENT_RELEASE`。无登记数据时在事务内执行原 down：
  删除自身动作、保留租户，随后 rollback；有 ComponentDefinition 时 down 退出 3，
  报 `component release downgrade would discard immutable evidence`，事务断开回滚。
- 原 `tools/gen-registry.py` 及 `--check`：退出 0，20 条能力、18 个封闭 kind；
  登记动作与受权目录路由由该追溯记录生成，不手改注册表。
- 同源 React 消费者的 `npm run typecheck`、测试类型检查退出 0；页面目标
  `component-releases.test.tsx` 5 passed，连同原 `pages.test.tsx` 为 190 passed。
  主动破坏原始 JSON 字节、重试幂等键、canRegister 表单门禁、Workflow 回执与未知
  状态检查后，5 项全部失败、退出 1；还原源码 cmp 退出 0，恢复后上述 190 项通过。

主动破坏检查对象后还原：把 Go 出站 U+2028 改成转义文本，检查报
`Core canonical request bytes changed on Go wire`、退出 1；仅在独占隔离库临时移除
原 AE 报告不可变 trigger，检查报 `immutable report rewritten`、退出 101。恢复源码
及 trigger 后，上述 Core、隔离落库和 Go 目标全部退出 0。无生产数据库读写。

## 未由这些证据证明的范围

当前登记消费者只支持 `EXTERNAL / APPLICATION / REMOTE_ADAPTER`、Adapter Protocol 1、
无前端 surface、模型模式仅 `NONE` 的明确子集。其他已冻结模式仍拒绝，不用该子集
冒充 Platform Component、内置 Cells/WeKnora/Wren、Host API 或模型计量接入完成。

以上隔离存储检查不冒充真实 OIDC/SpiceDB/Temporal/OpenBao 部署验收；候选完整
一致性配置、独立模拟身份密钥/JWKS 与真实原生组件部署需要在接受环境投递后
运行原登记动作。缺少这些事实的请求确定拒绝，不能用手填成功报告推进。
本批不登记 approve/revoke，不激活 binding，不创建三组件的菜单、工具或业务入口。
全量检查、最终四侧合并生成、产品构建、提交与部署由主线集中收口，未在本记录
冒称已执行。

## 登记回执与取消投影跨 run 恢复（2026-10-04）

复核发现原报告已提交但 ACK 丢失时，ComponentTask 的 Continue-as-new 会更新
报告 runId；原逐字比较把同一份原生证据误判为冲突。另一个取消分支在同步
task.in 之前返回，取消投影失败后的 Continue-as-new 会丢失已观察到的原生终态。

- 权威仍为 `.design/06` §2、§3.1 的原 Workflow 跨 run 收敛，以及登记的不可变
  AE/report；不是新状态或第二份报告权威。
- 影响限定原 Worker COMPONENT_RELEASE 分支和 Core 登记回执读取：只有 runId
  可因续跑不同，所有观察、artifact、contract、suite、plan 与执行身份逐字段相同；
  跨 run 回执额外要求原 AE 投影及 Temporal 当前 open run/first-run 链匹配。
  三端、契约、迁移与登记前真实权限/套件门禁不变。
- 已提交报告只读不重写，不再执行 suite；取消前同步累计观察、reconcile 状态与
  disconnected context，取消投影续跑不会从空观察开始。证据冲突为 CONFLICT，
  控制面不可观察为 UNKNOWN/DEPENDENCY_UNAVAILABLE，不把不明写入当作失败后再执行。
- 原 Go Workflow SDK 目标 5 passed，其中模拟登记 COMMIT 后丢 ACK→CAN→新 run
  返回原 receipt，第二 run 没有 probe；取消投影丢 ACK→CAN 保留 drain 结果，
  第二 run 不再执行 probe、不登记。SDK harness 显式模拟不同 runId，不冒充真实
  Temporal Server 验收。
- Core 定向 7 passed/1 ignored；隔离库目标另行显式执行 1 passed，消费上述
  Workflow 的两份报告及先前实际 wire 观察，调用生产 existing_registration：
  读回原登记，数据库只有一条 release、原报告原样保留；错 AE、改观察/摘要拒绝。
  独占隔离库沿原 69→70 条迁移基底，夹具事务全部 rollback。
- 把原报告比较恢复为逐字相等时，同一生产回执消费者实际返回
  `Conflict(TargetStateConflict)`，检查退出 101；把 Worker 取消同步恢复为旧位置时，
  检查实际读到 `ReleaseObservations:[]`，退出 1。还原后重跑上述目标与 Clippy。

本次没有 full、契约生成、产品构建或部署；也不改变上一节组件子集与未验收边界。

## 主线合并与四侧线格式（2026-10-04）

登记与恢复实现已合并到模板消息提交 `75eac99e74670ecde7de38879c451fe5b2c59449`，
选定树 `ddc701624711248aaafa4a1cb218787600295775` 为 69 文件 +8817/-175（含生成物）。
这不是最终提交树或部署回执；不包含仍在开发的 release 审批、binding 和步骤审批。
原 `tools/gen.sh` 与 `--check` 均退出 0，四侧类型及 Dart 同源文案一致。

合并后在原四侧 roundtrip 消费者追加同一组件观察样例：保留 ContentReference、
native scope、原生终态、UNKNOWN 和缺省证据，不将业务正文写进观察。Rust 6 项、
TypeScript 7 项、Dart 8 项通过，Go 原 contracts 包通过。逐侧主动改坏生成类型中
nativeRevision 的线格式或接口后，Rust/Go/TypeScript/Dart 分别退出 101/1/2/1；
精确还原后四侧目标均通过，四份生成物与上述合并生成树逐字一致。

Rust 首次目标退出 101：共享 target 复用了另一私有树的旧 contracts 编译物，虽本树
已有生成类型却报找不到类型；仅清理该包编译缓存后重编 5.71 秒，目标退出 0。
还原后的同批 workspace fmt 随后退出 1，原因是组件 mod 声明排序；修正排序后
原 fmt、gofmt 和 Dart format 检查退出 0。两次失败均保留，不替代最终整批检查。

原件目录 `/volumes/data/kailo/tmp/codex-component-post-integration-20261004.jHCT3k/`：
`generate.log` SHA-256 `b8c5020e3810f43c5a847f77c11beab1cb63250a0f8477b65eae8c53ebb54d37`；
`roundtrip-node-dart-restored.log` SHA-256
`63a7083d2adda2983b91c620ab05a71b9f72aff82000e397826be488c13afaa4`；
`roundtrip-rust-go-restored.log` SHA-256
`09e898619512a6fbb56179613871e82a4e8f252a2e3a1b9be13b489c08cfd9ad`（含上述 fmt 失败）；
最终格式回执为 `final-format.log`。SDK 固定同一镜像、4 CPU/8 GiB/swap 0、Cargo 16，
未修改依赖锁、业务状态或产品镜像。最终兼容比对、full 与发布仍由合并批统一执行。

## 在途执行遭后续拒绝时保留对账责任（2026-10-04）

交叉复核确认：protocol_cancel 的 execute 合法返回 RUNNING 后，原 Workflow
追加观察并清除当前探针的 reconcile 标记；下一个同 key 探针若 fresh 权限拒绝，
原逻辑会将整个套件标为 FAILED，错误地丢掉前一步仍在执行的 native 事实。
修正从原 Workflow observations 推导同 key 最新状态；有未核实终态时，授权或
配置拒绝保持 UNKNOWN、原轮询和 ContinueAsNew，只做原 key 的 reconcile。
未放宽 Core fresh 校验，不允许重 execute，也没有新增执行账本。Activity 已核验
的同 key 终态证据仍可结束一个不符合协议的套件，不把已终结执行永久挂起。

限定两文件 +97/-1，原件
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/component-release-drain-DfaUjx/handoff.md`；
patch SHA `13948bb939629a41468d538ab5f5efffed484cbdded15cba7fa70c8a3dc3a5a5`。
原 `go test ./activities ./workflows -run Component -count=1 -timeout=90s` 退出 0；
去掉生产 pending 守卫后两拒绝场景均实际失败、退出 1，逐字还原后同目标退出 0。
初次检查文件缺闭括号的失败保留；最终日志 SHA
`97b195fde6d9e00391c03473bc410801792e6b0ac56ef4d6a9b43a9961222c61`。
这是 SDK Workflow 模拟与源码路径验证，不是线上 Temporal/native 执行验收。

## 同批共享 Web 产物（未部署）

组件登记与步骤审批共享前端冻结后，原 `tools/build-upstream.sh web-client`
单次执行退出 0，既有 BuildKit 8 CPU/16 GiB/swap 0 与 Data 缓存；没有为两文件
Worker 修正重编客户端。原 helper 登记 source
`7e9dac90326e7a57d4f40a0c4445179c2010d1494e5d3733626496db64890e26`，artifact
`a49e108c5cbef35c9876e05ab940ebd6a3cd48f71ab743eaeb91acadcc70686e`；
registry manifest 独立读回摘要相同。npm audit 为 0，原 chunk size 警告保留。
日志位于上节主线目录 `step-web-build.log`，SHA
`62c5e7230b91c4bab1ed2c9fab19a7f580b812fd094533e9a26eac82bc7dcedf`。
这里只更新产物来源及部署声明，未应用 Compose、重启服务或调用真实登记动作。

## 合并批次完整门禁回执

相对 `75eac99e74670ecde7de38879c451fe5b2c59449`，固定树
`9e41d5c4fc6e9b074c84a3c9eef6184660b3d1ec` 为 114 文件 +11794/-752，含本登记、
Automation 步骤审批、消费前撤权重验、四侧生成物和 Web/Win11 实际来源。
原 `./tools/check.sh --full` 最终实际退出 0，输出 `全部通过。`。SDK 为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
实际 4 CPU/8 GiB/swap 0、UID 1000、Cargo 16；只用 Data 缓存与本批私有数据库，
没有变更正在运行的业务库、服务、权限、额度或调用模型。

四侧静态与原验证、190 个 schema 同步及历史兼容、真实迁移前进/回退/再前进、
SQLx 离线核对、44 个命名枚举约束、Workflow replay、20 条追溯、六份上游来源、
32 个产物与原安全门禁全部通过。Core 主单元 154 passed/7 ignored；另两项显式
外部演练 ignored。未投递专用环境的演练不计业务验收。实际部署配置预检因导出树
没有 `.env` 明确 SKIP；内置秘密扫描通过但未安装 gitleaks。未签名 Win11、Mobile
release 签名、真实审批/Adapter/native 链及三组件接入仍不据此闭合。

实际失败及纠正均保留，不合并成一次成功：

- 首次入口在依赖准备退出 2：`Got socket error trying to find package test at https://pub.dev.`。
  隔离 PG 的网络不能访问公网；核对 pubspec 相同后，仅向临时检查目录复用此前 SDK
  生成的 Dart 锁，再执行原入口。没有改产品依赖、安装宿主 SDK 或绕过原检查。
- 首次完整执行退出 1，只有新追溯的 DD-100 阶段归属与缺 Web artifact digest 失败。
  DD-100 的首个归属仍在 S3；本记录只列自身 EXT-BASE 决策，注释和证据正文保留
  原动作策略依赖。补入已实际构建的共享 Web 摘要；Core/Worker 未发布，不借旧镜像
  冒充本批。surfaces 只列真实存在的 Web/Desktop 表单，不把生成 Dart 类型当 Mobile
  管理页面。没有修改覆盖矩阵或门禁规则，也没有重新构建任何产品产物。
- 修正登记后原完整入口退出 0；最终证据文档只运行原文档快路径，不再次全量构建。

原件目录 `/volumes/data/kailo/tmp/codex-component-post-integration-20261004.jHCT3k/`：

| 日志 | SHA-256 |
|---|---|
| `full-prepare-no-network.log` | `4d120400ccc8679c2c8ea681e0d1dcf12681c3cfd53f5651404e6b72ac77692c` |
| `full-trace-failed.log` | `01c49a3671b6b3e1b19eb6d391d40955a7b79fab970fd4e755a4f7d09c7cdef0` |
| `full.log` | `dbea321f336f7aeec742b4464f4ef4f3ea3c4e71095b07ef3f72590873ab869f` |

全量终态后，私有 `component_step_jhct3k` 删除前读回 72 条迁移，最大版本
`20261004017000`、失败 0、连接 0；精确 DROP 与不存在读回均退出 0。只清理
该可重建验证库，未删除 PG 容器、其他数据库或业务数据。

## 原生协议一致性执行的凭据投递（2026-10-06）

本批修复 `PROTOCOL_PEER` 登记执行的实际缺口：原路由只声明 native MCP host，
没有把该端点要求的凭据投递给 AgentGateway。不是把匿名请求或 Core JWT 当作
原生凭据，也不据此把 WeKnora 的完整 KNOWLEDGE 参考实现改成 PROTOCOL_PEER。

- 权威为 DD-70、DD-94 和本文件原登记链；`ComponentProtocolPeerEnvironment`
  新增可选 `nativeCredentials`，直接引用既有 `ApplicationPeerCredentialDelivery`
  Schema。沿用 manifest SecretRef、OpenBao 原审计读取、Gateway 受控文件投递，
  不新增 secret store、绑定记录或浏览器凭据。
- 影响为原登记 AE、不可变环境摘要与 peer 路由：按真实 Catalog Tenant 校验
  locator、版本、audience、manifest 声明、header/prefix；原 binding 投递行为不变。
  conformance 使用从原 AE 派生的独立投递命名空间，避免撞同 AE 的 binding 投递。
  AE 必须仍为原 `component_release.register` 的 ALLOWED/DISPATCHED。
- 缺声明、错 Tenant、零版本、未知 key、Cookie header、换行 prefix 均拒绝；
  取密或审计不可观察不生成可用路由。没有 native secret 声明的旧环境可继续省略
  新字段；声明了秘密却缺投递映射不能作为匿名回退。没有更改管理员审批或额度。
- 在既有 4 CPU / 8 GiB SDK 上原生成入口退出 0；四侧原往返验证实际为 Rust 22、
  TypeScript 27、Dart 22 项通过及 Go contracts 包退出 0。共享样例只含版本化引用，
  每侧均核验新字段完整保留和旧格式缺省可读，不把该样例结果称为旧部署接入验收。
  Core `credential_tests` 5 项通过；`component_release::report_tests` 9 通过、
  1 个真实 wire 数据库演练 ignored；同批 `web_transport` 27 通过，Clippy
  `--all-targets -- -D warnings` 退出 0。

在 SDK 私有副本将 conformance 的真实 Tenant 改为固定夹具 Tenant 后，跨 Tenant
负例实际失败（1 failed，退出 101）。随后以正式源原字节恢复，cmp 退出 0，
credential 5 项重新全部通过。日志在
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`
的 `forum-delete-core-mutation.log`、`forum-delete-core-route.log` 和
`forum-delete-final-ui-contracts.log`；生成日志在同一 Data 父目录的
`peer-conformance.aL7wGw/generate.log`。

本批没有 full、产品构建、Core 部署或 live release/binding 批准；真实 Catalog
目前仅核到一位 ACTIVE admin，原 self-approval DENY 未修改。原生 WeKnora MCP
的 authenticated initialize、tools/list 和空知识库只读调用是 native API 连通事实，
不等于五个知识契约通过一致性、模型投递或协作平台入口已启用。

## 隔离套件复用生产 Adapter 报文与参数绑定（2026-10-06）

原能力向量的 `contractKey/inputJson` 是套件输入，不是生产 Remote Adapter 的
`actionKey/arguments` 报文。此前直接发送向量，且将 execute 参数散列为
`{operation,arguments:整个请求}`，与生产 NativeConnector 的消费方式不一致。
本批按 DD-102、`.design/07` §8A 和 ADR-12/19 修正原执行接缝，没有新建执行器。

- 权威和影响：Core 在原登记计划冻结阶段把能力向量转换成生产
  `{idempotencyKey,actionKey,arguments:{target,input}}`；target 来自受控隔离上下文。
  前序真实 typed reference 只填 `arguments.input`，并按原能力 Schema 再验证。
  Worker 继续发送 Core 返回的 canonical 原字节，删除原先重复追加影子字段的路径。
- 认证和副作用：execute 复用生产 `arguments` hash、HUMAN initiating actor、授权
  revision、native execution 引用与幂等键字段；其他协议操作保留原 operation 域分离。
  独立 issuer/audience/OpenBao 用途/JWKS、真实 Catalog scope 碰撞拒绝及每次 fresh
  管理授权均保留。模拟执行引用不落生产 ExternalExecution，生产 PEP 不接受这些
  隔离凭据；没有为候选组件创建 ACTIVE binding、审批或真实业务权限。
- 边界：错 action/target、nil 幂等键、旧 execute 线格式、缺模拟授权 revision、
  缺 execute 模拟引用、试图覆盖非空向量 input 均拒绝；UNKNOWN 的同键观察、撤权、
  暂停、过期、上下文漂移与原生终态证据检查沿原生命周期，不重复 execute。
- 兼容：`ComponentConformanceIdentity.contexts` 新增必填
  `authorizationMinZedToken`；execute 还要求 `externalExecutionId`。旧隔离投递必须
  重新提供这两个真实模拟环境引用和生产形状的 execute 向量，不能静默生成默认值。
  已冻结计划的 identity 摘要发生变化即拒绝，不在运行中改写原计划。新增样例证明
  四侧字段往返，不证明旧隔离配置透明兼容；原历史兼容检查只比顶层字段，不能据此
  宣称该嵌套 required 变更无破坏。生产客户端业务请求与实体 Schema 没有因此变化。

在原 4 CPU / 8 GiB SDK 的独立 `conformance-wire.kT1a34/apps` 中执行原
`tools/gen.sh` 退出 0，四侧生成包含同批 Members 两个可选布尔字段和既有
`AgentInstallationView.canUpgrade`。TypeScript `tsc --noEmit -p tsconfig.test.json`
退出 0，原 Node roundtrip 输出 `tests 32 / pass 32 / fail 0`，Dart roundtrip
`27: All tests passed!`；Go 原 contracts、activities 的
`Test(ConformanceIdentity|ComponentConformance)` 两包退出 0。
首轮生成因私有快照漏原 i18n 生成脚本退出 1、首轮 Node 因缺现有依赖链接失败；
补齐原输入后复跑通过，未修改产品依赖或测试断言迁就失败。
原 `tools/gen.sh --check` 随后实际输出四侧同步和同源 Mobile 文案 PASS，退出 0。

同一既有 SDK 与 Members 变更合批执行 Core 窄验：
`component_conformance_identity::tests` 3 passed，
`component_release::report_tests` 11 passed / 1 ignored（需真实 Go wire 与隔离库的
旧演练本次未执行），Rust 原 contracts roundtrip 27 passed，
`cargo clippy -p platform-core --all-targets -- -D warnings` 退出 0。
首次新测试把 `reference` 移动后再借用，编译报 E0382；只修正测试的 clone，
不改产品行为或缩小断言。随后上述合批全部通过。

在 SDK 私有副本把 execute hash 恢复成旧 `{operation,arguments:整个请求}`，
新生产参数绑定用例实际 1 failed、退出 101；恢复正式原字节后 identity 3 项、
report 11 项通过，原 ignored 边界不变。原件在同一 Data 父目录的
`projects-directory.wiWDv3/member-actions-core-final.log`、
`conformance-core-mutation.log`、`member-actions-core-mutation-restored.log`。

上述原件位于
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/conformance-wire.kT1a34/`：
`generate.log`、`generate-restored.log`、`roundtrip-worker.log`、
`roundtrip-worker-restored.log`。本批没有 full、镜像构建、部署、live 套件登记或
五键业务验收；完整隔离 native fixture、独立模拟 PEP 和实际五键消费者仍须真实
投递与执行，不能把本次报文一致性修复当作它们已经可用。

## 2026-10-10 原启动入口的隔离套件投递

权威与原因：`.design/07` §8A、DD-94/101 的登记执行仍归原
ComponentTaskWorkflow。Core 的 `protocol_fixture`、
`component_conformance_identity::load` 和 Worker 的
`RunComponentConformanceStep` 已消费受控文件；原 `start-core.sh`
只挂载 ApplicationAdapterDirectory，未把套件文件交给实际进程。
本批修正部署生产者，不生成隔离身份、native fixture 或通过报告。

影响面：`start-core.sh` 复用原规范文件/public-only JWKS 校验和临时
Compose overlay。HTTP adapter 投递 environment、fixture、identity 三项，
必须声明同一 artifact；原生 MCP peer 只投递自己的 environment。
Core 只读挂载所需文件及 identity 引用的公钥，Worker 只读挂载 environment。
有套件环境时原入口在 Core 后以同一 overlay 重建 Worker，否则保留原启动
行为。数据库、契约、Workflow 类型、登记/审批状态和三端页面均不变，
无需数据迁移；旧进程未重建前不会获得新文件。

副作用与边界：全缺省不引入业务组件依赖；半份 HTTP 输入、混合 artifact、
缺失/相对/符号链接路径、重复 JSON 键或公钥文件中的私钥材料在获取一次性
OpenBao 投递前拒绝。密钥仍由 Core 现有 OpenBao 消费者读取；完整 schema、
算法、权限、用例覆盖与结果证据仍由原 Core/Worker 验证。不放宽失败分类，
不重试结果不明的组件动作，不把文件挂载当作 release 或 binding 已启用。
修改套件候选前须先查清原登记 Workflow 的在途状态，不能靠切换文件重放。

用法：在原 `.env` 提供 `COMPONENT_CONFORMANCE_ENVIRONMENT_FILE`；HTTP
adapter 同时提供 `COMPONENT_CONFORMANCE_FIXTURE_FILE` 与
`COMPONENT_CONFORMANCE_IDENTITY_FILE`，然后沿原 `start-core.sh --no-build`
投递。文件必须事先存在。关闭套件时移除这三项并通过原入口重建 Core，
同时用不含套件 overlay 的原 Compose 重建 Worker，避免残留旧候选配置。
此操作不批准组件，也不代替绑定停用流程。

实现后复用 `tools/check.sh` 原 security 中的部署生产者检查，未建新检查脚本。
在既有 4 CPU/8 GiB SDK、UID 1000、Data-backed 私有快照执行
`bash -n deploy/local/start-core.sh tools/check.sh`，再执行该检查段；首次退出 0。
仅在私有快照关闭实际生产者的 artifact 相等校验，原检查退出 1：
`AssertionError: 不同候选 artifact 不得混合投递`。正式源码未被破坏，
私有副本已还原并与正式脚本逐字 cmp 通过；还原复验句柄 12778 实际退出 0，
原检查再次输出 PASS，两个 shell 的语法检查及本批 `git diff --check` 通过。
快照为 `/volumes/data/kailo/check-cache/conformance-delivery.rogmUz`。
完整 `tools/check.sh --full` 已针对独立候选树
`f9784f9b92f8279e3293999c04c97d8e0baaddde` 启动，日志位于
`/volumes/data/kailo/tmp/component-delivery-commit.CVKZK5/full.log`；截至下述走查，
句柄 32210 仍存活且处于源码导出，尚无退出码，不记为通过。
本批尚未执行实际套件登记或部署。

2026-10-10 15:29 UTC 使用 `playwright-cli` 在原
`knowledge-catalog-register` 会话重新完成正常 SSO，经成员管理分别打开
“组件发行版本”和“外部服务连接”。前者显示三个清单输入、禁用的空输入预览
及 Catalog 无发行版本；后者显示连接配置输入、禁用的空输入预览及当前作用域
无连接。两张截图已实际打开复核，原件为上述 Data 目录下的
`catalog-releases-20261010.png`、`catalog-bindings-20261010.png`。
这仅证明当前已部署 Web 的两个管理空态可达，不是本批新部署、原版全量一致性、
英文或三组件业务验收；没有填写清单、提交登记、审批或创建绑定。

17:12 UTC 续查原完整检查容器，格式/Clippy/Go vet/TypeScript/Dart 静态检查、
四侧生成同步及 296 个 schema 的兼容检查已通过；实际数据库演练因未提供
DATABASE_URL 明确 SKIP。Core 测试报 363 passed、1 failed、51 ignored：
`stream::tests::forum_kinds_are_native_workspace_events_not_private_conversation_events`
的旧期望列表遗漏原生产列表已有的 `40008`。这是被冻结基底的真实失败，
没有改动在途检查输入或把失败标成通过；工作区的对应修正尚未进入该冻结树。
完整检查仍在继续，其后日志从同一容器接续保存为上述目录的
`full-resumed.log`。本批可以独立提交已定向验证的投递源码，但不表示完整门禁
已通过，也不批准组件、不激活绑定、不作为生产就绪或新部署声明。

17:47 UTC 已验证上述 Core 检查的旧期望修正。依据仍是固定 Buzz
`779af8886caae1317b4de962082429867ab61503` 的
`crates/buzz-core/src/kind.rs::KIND_STREAM_MESSAGE_DIFF` 和既有读取恢复；
`StreamScope::message_kinds` 生产集合未改，只在 workspace/conversation
两个预期列表补回原生 40008。没有修改字段、契约、迁移、订阅授权、历史读取或
发布准入，不把 forum 消息放进私聊，原跨 scope、验签和 Relay overlay 断言保留。
这不是新增能力或新的检查脚本，也不是修改在途 full 输入使旧失败消失。

原 4 CPU/8 GiB SDK、Cargo 16、SQLX_OFFLINE=true、Data 缓存中执行：

```text
cargo test --locked --offline --manifest-path core/Cargo.toml -p platform-core --bin platform-core stream::tests -- --nocapture
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 411 filtered out
```

实际退出 0；私有 `human-reader.gcbX3d` 的该文件与正式源码逐字 cmp 退出 0。
日志为 `/volumes/data/kailo/tmp/cells-share-native.0fuX6u/stream-native-kinds-restored.log`。
日志 SHA-256 为 `b80dea0725ee6f1f189621ca03e355609204bb8ef9bff064684d6250b33be39e`。
这只证明该四项检查，不替代最新 main 全量验证。原冻结 full 后续还出现
TypeScript 26 failed/1070 passed，涉及 pages 和 workflow-definition 两个文件；
截至此记录仍未终态，不能报告 full 退出 0。本批未构建镜像、部署或激活组件。
