# ApplicationBinding 与原 APPLICATION Tool 消费证据

本批实现位于联合私有候选 YVnkF3，基线
`6090de81a13322f85dcc77b1a862cb203dbb7422`；主线另外保留已发布增量。
源码与定向检查不等于部署、真实参考服务接入或生产验收。

## 实现前四步结论

1. **权威。** `.design/03` 的 Binding、ActionToken、ExternalExecution，`05` 的原治理动作，
   `07` §5.2/§6.2/§6.3 决定接入、激活与停用；ADR-12 只细化原传输。
   ComponentTaskWorkflow、ActionExecution、原 Catalog、SpiceDB、OpenMeter 与审计继续各自权威。
   binding 不控制独立服务的进程、数据库或内部管理；NATIVE_PAGE 仍是独立服务页面。
2. **影响面。** create/disable 原 ActionCommand 与 Workflow DTO、Core admission 与 service API、
   Adapter typed observation、Gateway 原 MCP route、Version/Installation ToolBinding、Delegation、
   共享 Web/Desktop binding 页面和四侧生成消费者同批接线。AE 首写冻结原 definition 技术 ID、
   binding/release/generation，旧平台定义不回退到 APPLICATION。迁移使用原表扩展和新增原领域表，
   不覆盖生产旧数据；有事实时 down 拒绝，不能靠清空事实证明可回退。
3. **副作用。** 正文参数和结果只在请求内存中处理；Core 持久化参数摘要、引用、准入与观察。
   原 OpenMeter Customer subject 投递复用既有 replace 锁、派发回执、完整 readback 与不重放规则。
   Gateway 是唯一 MCP 注册/发现/调用路由；Core 仅投递批准元数据并核验原配置摘要。
   ActionToken 私钥只由 Core 从原 OpenBao 读取；机器传输 token 不覆盖业务 Authorization。
4. **边界异常。** 新业务调用要求 ACTIVE 精确 generation、现行 Delegation/权限、审批与额度。
   UNKNOWN 先落原 EE 再向 Gateway 放行，丢响应只观察原幂等键，不重新 execute。
   签票只在内存中预备，原 parent → Invocation → child 锁序下重新核验准入，计量映射冻结与
   DISPATCHED/UNKNOWN 派发标记同事务提交；计量读取或签票失败不留下未外发的已派发事实。
   计量准备后再次用原公钥验证 token 未过期，提交前失败整体回滚，PEP 不接受 NOT_DISPATCHED。
   原生 terminal、用量关联、原 outbox 的 stored_at 和审计分别查证；未闭合时不伪造 DISABLED。
   撤权后系统仅观察原 EE 元数据，不向原用户披露正文；调用结果披露仍 fresh 检查。
   只对 binding 实际选择的类别检查执行能力，SYNC + NONE/APPROVAL 可进入现消费者；未实现的
   EXPLICIT elicitation 与其他执行模式在准入前拒绝，不生成可发现后才必失败的工具。

## 实际调用位置

- `application_binding::prewrite/advance` → 原 ComponentTaskWorkflow →
  `native::validate`、原权限/计量/Gateway projection → 原终态审计。
- `agent_tool_runtime::configuration` → `application_tool::configuration` → 原 Gateway route；
  Core 重启仅对原确切 route 的会话公钥投影恢复，不改 target、规则或 Tool 权限。
- 原 ExtMcp `Policy::request` → `application_tool::prepare/dispatch` → 原审批消费、原 EE 与用量投影 →
  Core ActionToken → Gateway 转发能力原 input。target 来自明确的 `{target,input}`，不是 metadata。
- `Policy::response` → typed native observation → 原用量/审计收敛 → fresh 内容披露。
  AgentTask 的原结算循环与 COMPONENT_DISABLE 观察同一 EE，无第二执行循环或账本。
- `application_binding::pep::check` 精确绑定 OIDC client、audience、ActionToken、原 AE 和参数摘要；
  系统 observe/extract_usage 只允许严格 EE 引用，不续发已撤权人的业务读取授权。

## 已运行与边界

以下日志均在
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/application-binding-20261005.YVnkF3/`：

- `application-core-check.log`：首次 `--locked` 拒绝需更新锁，未宣称通过。
- `application-core-check-locked.log`：原受限 SDK 的
  `cargo check --locked --offline -p platform-core --all-targets` 退出 0，32.59 秒。
  唯一 unused `Tool.tool_declaration` 警告随后连同旧读取字段删除；此日志不是删除后的复验。
- `application-worker-check.log`：首轮 Go 因两个生成的同形 nominal target 类型赋值失败；
  `application-worker-restored.log` 记录显式生成类型转换后的全包与原 replay 通过。
- `application-core-tests.log`：原 Core 单元与集成检查通过，含 178 个单元检查及 9 项 ignored；
  随后 Clippy 退出 101，报告 tuple 类型复杂度、惰性 Option 错误构造、测试模块位置与冗余借用。
  tuple 别名、Option 与测试模块位置已收束；集中复验结果见下节。
- 交叉复核发现旧 dispatch 在计量准备和签票之前提交原 EE，前置失败会遗留未外发的
  PENDING_DISPATCH。现 `issue_application` 预签后，`dispatch` 在同一事务消费
  `application_execution::prepare_in_transaction`，再提交 UNKNOWN；未保留旧 prepare wrapper。
  此修正由下节真实原生客户端 HTTP 503 与隔离数据库回滚检查覆盖，不能代称完整 dispatch E2E。
- `execution-handoff.md` 及 `execution-db-*.log`：原 EE/用量/审计写者的隔离库事实、负例与恢复，
  由该模块作者留存；不把空迁移通过代替真实 EE 插入证据。
- `application-binding-client.md` 记录共享页面实际消费者检查；native page 另有原回执。

## 派发前置回滚的实际后置验证

`application-core-restored.log` 首轮退出 101，原因是测试中 `Acquire` 与 `Connection` 的
`begin` 方法二义性；改成 `sqlx::Connection::begin(&mut conn)` 后，统一批次
`application-core-restored-2.log` 退出 0：Clippy 0，真实隔离数据库目标 1 passed，
Core 单元 178 passed / 10 ignored，contracts 10 passed；原 Core 集成目标也通过。
ignored 保留原条件，不把其省略视为通过。日志 SHA-256：

```text
d30bdfae4d55704cd4dd5aa237662e379d876f6a5f8cf0aaaffefa67a777f68d application-core-restored.log
e03528681dabc3c259803ef145ece0f6d7e26f576fcfc2534a68e1f19ba435ee application-core-restored-2.log
```

实际目标 `openmeter::meter_key_tests::application_preflight_failure_rolls_back_original_dispatch`
调用生产 `application_execution::prepare_in_transaction` 和原 OpenMeter HTTP 客户端。
本地接收端明确返回 503 后，原事务回滚，child 仍 NOT_DISPATCHED，EE 及计量冻结不存在；
同一 child/幂等键再次准备，真实客户端读取受控 Customer/subject/meter 回执后冻结映射，
原 EE 转为 UNKNOWN。外层事务最后回滚全部本目标数据，不调用模型、Adapter execute 或业务库。
这证明生产计量准备与调用者事务的失败边界，不证明完整 Gateway/审批/签票 dispatch E2E。

已执行的原 SQL 字节现存于 [隔离基底](application-execution-base.sql) 和
[派发夹具](application-execution-dispatch.sql)。前者只用于迁移完成的**新独占空测试库**，
不得在业务库或已含该基底的库重复执行；后者由测试通过仓库相对 `include_str!` 读取，
不再依赖 `APPLICATION_DISPATCH_FIXTURE` 或 Data 临时路径。已验数据库
`application_execution_yvnkf3` 位于 `kailo-installation-scope-pg-e4agxd`，当时已应用 79 条迁移。
复跑须沿既有受限 SDK、该隔离 PG 网络命名空间和独占数据库连接，在 `apps/core` 执行：

```sh
# DATABASE_URL 和 APPLICATION_EXECUTION_TEST_DATABASE_URL 只指向新独占隔离库。
sqlx migrate run --source migrations
psql "$APPLICATION_EXECUTION_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f verify/application-execution-base.sql
cargo test --locked --offline -p platform-core application_preflight_failure_rolls_back_original_dispatch -- --ignored --nocapture
```

该目标在已含原基底的隔离库可重复运行；不要重复基底写入。此次搬入 SQL 字节与原已测输入
逐字一致，仅更换测试夹具的来源位置，未重跑 Cargo，不能把路径调整另报为一次新验证。

本文件不宣称全量检查、镜像构建、部署、Cells/WeKnora/Wren 业务接入已通过。
真实部署还必须具有批准 Release、独立 ServicePrincipal/IdP client、准确 Adapter 目录、
OpenBao 公钥/凭据投递、合法业务 Resource/Delegation 与受控上游；缺任何一项仍 fail closed。
通用 `resource.create` 的实际业务对象创建消费者、Cells 的原生 Adapter 运行体与
`query_revision` 消费尚不在本批验收范围。现有 Tool 的 typed ContentReference 只检查
授权目标，不能据此宣称原生引用或历史 revision 已查证。因此本批结果含 typed
ContentReference 时在原生执行／用量收敛之后确定拒绝披露，不记为组件读取完成；旧的
仅比对平台 ID 分支已删除。后续读取必须按原契约补齐真实 Adapter 解析。
`query_revision` 的 current head 不等于历史 revision，不以一律等 head
替代历史引用语义。以上缺口未因目录、binding 或工具元数据投影存在而关闭。

## 2026-10-05 联合批次检查与安装包交付恢复

联合批次现以已发布 `43471e5df07a5a0e4a94b1e21ba77784fbdec7fb` 比较，
不把此前已发布的 Agent handoff 增量重复计入本批。接入列表、原生页面与已有
组件发行目录的 BFF 路由改用原 `exposed_route`，由既有追溯生成器产生公开能力记录，
不新增另一套路由权威。新记录包含 create/disable 两动作和两个既有 Workflow kind；
未开放的 `resource.create` 不随接入页面开放。

事后把生成记录的 `exposure` 从 `end_user` 临时改成 `none`，原
`capability_registry::tests` 在 `route_exposed("/api/v1/application-bindings")`
断言失败，退出 101；原字节恢复后生成器 `--check` 通过。破坏日志
`application-registry-mutation.log` 的 SHA-256 为
`dc96414e46bab8931c0a605d25ab2ade7ed095073a3302ba0ff60be80a738c2a`。

受限 SDK 的首次联合 `tools/check.sh --full` 实际退出 1，保留三项失败：
Worker 新活动的一处 gofmt、Desktop 新包未写回来源登记、部署配置预检。
其余四语言验证、replay、21 条追溯、供应链检查通过；追加的真实隔离数据库
派发前置回滚目标退出 0，使用入库的 `include_str!` 夹具。原输出为
`FULL_EXIT=1 CASE_EXIT=0`，不是全量通过。日志 `application-full.log` SHA-256：
`fb09bb537633db8f412278fcbb47d4d77e734c387a73052a97fa2fa427cc3913`。
gofmt 已在同一受限 SDK 中修正。配置失败定位为检查容器缺少 sole `.env`
只读挂载，候选路径仅有零字节占位；未删校验或修改实际部署配置。

原 Windows 构建的 NSIS 与 BuildKit 导出已经完成，随后因候选 `dist` 为 root
所有而在 `mkdir dist/desktop-client` 失败。仅纠正该空目录所有权，按原脚本的
`install` 与 `upstream_manifest.py record` 尾部步骤恢复，不重复编译。
实际包为 `dist/desktop-client/Kailo_0.5.23_x64-setup.exe`，15,115,615 字节，
SHA-256 `fb40230d0e99386425e55d959e5fd324cf5b2811be11e7ae42688b93ec523ed6`；
source digest 为 `a62df8190967f17450c8154b593adeeeee3f1c8928a066ee1d0cb53195c8c998`。
原失败日志 `application-desktop-build.log` SHA-256 为
`e65b44b3f2cfa046f62f8904053b81ddcb1394348c1785506d0e0c7e08ea758b`。
这是未签名候选包，不是 Win11 设备验收、线上投递或组件真实服务验收。

最终复验在固定 SDK 镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
中运行，实际限额 4 CPU、8 GiB 内存及 memory+swap，Cargo jobs=16；现有缓存位于
Data 目录。补充 sole 配置的只读挂载后，原检查未作任何放宽。
源码索引树 `cc88622ce42155fc79c0d905e24ddb0c658c322d` 的
`tools/check.sh --full` 与追加隔离库目标均退出 0：

```text
全部通过。
FULL_EXIT=0 CASE_EXIT=0
```

`application-full-restored.log` SHA-256：
`f151c2a058839215f14d31986d3b4fb1c546eee48fd504e7486a8df116df76e6`。
本轮未提供通用迁移演练的 DATABASE_URL；隔离库专项连接单独投递，
不能把追加的一项目标当作全部数据库演练通过。Core 常规执行仍有十项显式忽略，
未安装 gitleaks，Desktop/Mobile 签名与设备验收仍未完成。随后只补本回执和 README，
不重复编译产品。检查范围为选定候选批，不包括正式树保留的其他未提交修改。

## 2026-10-05 APPLICATION 工具响应消费修正

本增量以 `d343a33ed491f12f60efbddfd973a1053461c8ef` 为基线。实际缺口是
`application_tool::disclose` 已按冻结 output schema 校验 `resultJson`，却返回
Adapter 执行包装；`agent_tool_pep::Policy::response` 又忽略该返回值，继续把包装
作为工具结果。现只返回经过 schema、目标权限与 fresh exposure 检查的业务值，
原 PEP 用 rmcp 的 `CallToolResult::structured` 重建响应，不转发上游附加文本、
图片、链接、元数据或执行包装。Memory 的原精确编码检查仍在披露消费前执行。
没有改变身份、scope、审批、EE 终态与用量收敛规则。

实现后在原 SDK `10ad51a2…`、4 CPU/8 GiB、memory+swap 同限额、Cargo jobs=16
与 Data 缓存中执行原入口：`cargo fmt -p platform-core --check`，以及
`cargo test --locked --offline -p platform-core --bin platform-core`
分别过滤 `application_tool_tests` 和 `tool_pep_tests`，最终 3+4 项通过，退出 0。
PEP 检查直接消费生产重建函数，不仅检查业务解析助手：把该函数改回从
`raw.structuredContent` 重建，原包装与执行引用泄露断言实际失败，退出 101；
逐字还原后两组再次 7 项通过。首次两个执行副本遗漏 collaboration workspace
成员使 cargo metadata 退出 1，补齐同一基线原输入后继续，失败原件保留。

原件位于 Data 私有目录 `codex-protocol-peer-20261005.tm8mte`：
`response-targeted.log` SHA-256
`04a3b6f92e2ee250e4aae7fc55a2d83dace3486721e893672ccad67f21080d70`；
`response-mutation.log` SHA-256
`6663a7490c56c26681823c9b320ff4316972b73056a513cce5650a09fda1cdf3`；
`response-restored.log` SHA-256
`03a361b9e6705eb4e97e56235a7a9eb63479b6be799d5cab362425b2f831c8c8`。
这些是响应消费的定向证据，不是实际 Gateway、组件派发或模型调用 E2E；
本轮没有运行全量、构建产品、部署、写业务配置或修改 `.references`。

`PROTOCOL_PEER` 入口仍关闭，本修正不冒称已支持 Wren。固定 Wren
`871118e94f1525c401d867074c05e7e8eefca1cc` 的
`.references/WrenAI/core/wren/src/wren/mcp_server.py::build_server`、
`run_server` 与 `_register_query_tools` 提供原生 Streamable HTTP MCP，
不提供本地 AdapterExecutionResponse 或 native task 对账包装。
设计 `03` 第 371 行及 DD-98 规定应用 Resource 仅经 `resource.create` 和
remote `resolve_native_scope` 建立；`03` 第 402 行、`07` §5.1 又限定 peer
不接 ActionToken/该管理协议，而 `08` §6 要求已固定的语义模型 Resource/Asset。
当前 `application_tool::target_facts` 必须读回真实 ACTIVE 对象；合法首次建模来源
尚未闭合，不能从部署配置或 MCP 列表伪造对象。登记/绑定的 Adapter 专属验证与
原生 MCP 的丢响应终态边界也未据本次窄修开放，不新增代理或虚构 EE。

## 2026-10-05 原生 PROTOCOL_PEER 消费链

后续以设计提交 `36bab8398fa22a3ef2542db384ee72a042a04174` 的
DD-12/58/94/98 为依据扩展上述窄修。Core 沿原 ComponentTask 完成受控隔离套件，
使用固定 rmcp 3.1.2 的 Streamable HTTP 客户端，经已有 AgentGateway 和双相 PEP
执行 initialize、tools/list 及冻结声明中的只读向量。原 ComponentRelease 批准
实际读取 Core/Worker connector 能力，不能用 Adapter 版本替代 MCP 消费能力。
Remote Adapter 原合同未改，原生 peer 不接收 ActionToken 或虚构 Adapter 包装。

绑定仍沿原 lifecycle AE、runtime projection 和 Gateway route。实际 SDK 协议发现
与受控目录的 exact binding/tenant/service principal/native instance/scope/config
共同核验，成功后才能 ACTIVE；MCP readOnlyHint 不授予权限。目录可携带既有原生
对象的证据引用及 digest，但本批不从裸 ID 建 ACTIVE Resource：原 resource.create
producer 由独立增量消费。停用只保留已 ACTIVE 原生引用，未完成 Resource 投影
仍由其原 RESOURCE_PROVISION 收敛，不将 PROVISIONING 伪报为已保留对象。

业务调用使用原 APPLICATION 子 AE、审批、Delegation、fresh target/exposure 和
冻结 output schema。当前明确支持 SYNC、workflow/quota NONE、空 meters、
SYNC_RESULT 且无 progress/usage/cost source 的合同，不把未观测计量填为零。
派发前原 child 标为 DISPATCHED；native CallToolResult 只生成原 AE 的协议终态
审计，不造 native job/ExternalExecution。标准 TextContent 保持字符串，结构化值
保持原值；只披露已校验业务值，不透传包装、额外文本/图片/链接。缺回执维持
UNKNOWN，不执行重放，也不宣称原生支持 observe/cancel。原 AgentTask 结算与
binding 停用均将该无 EE 的 child 纳入终态全集，不能因没有 EE 就跳过。

协议终态消费在写原审计前校验同一冻结 output schema：空结果、多块或未知类型、
schema 不符不构成远端失败证据，拒绝披露且不写终态，原 child 继续 UNKNOWN。
仅合约有效结果记 SUCCEEDED，协议明确的 isError 记 FAILED；撤权后的系统收敛
不会重新授予用户内容读取权限。部署支持范围仍有限：当前 peer 只允许原声明与
binding 都不需要 SecretRef 的目标；独立 peer secret 投递尚未接入，不能用平台
Core/Agent bearer 代替。两路 Gateway 请求 PEP 均移除 Authorization 与平台引用
headers 后再转发，native target 没有 backendAuth。本批不声称同 MCP 不同 secret
的资源隔离已经完成。

上述 header 行为依据固定 AgentGateway
`1f7ebbf87cbdbe9517f6f181221879d04dc50692`：
`.references/agentgateway/crates/agentgateway/src/mcp/guardrails/client.rs::apply_request_side`
修改同一个 IncomingRequestContext，`apply_header_mutation` 先 set 再 remove；
`.references/agentgateway/crates/agentgateway/src/mcp/handler.rs::generic_stream`
在 guardrails 通过后才用该 context 调用原生目标。这里只登记源码与本地消费者
证据，未宣称已在真实带 secret 服务验证平台票不外泄。

固定 SDK 的日志 target `rmcp` 和 `rmcp::*` 会记录上游错误正文/未知通知，故在
现有日志 layer 固定过滤这两个精确范围；其他 crate 和原 Core 错误分类/审计保留，
RUST_LOG 不能重新开启该 payload 日志。HTTP 超时和 SSE event size 沿 SDK/部署
配置；JSON 结果在解析后核大小，本批不将其冒称为解析前硬内存界限。

这是一条通用协议消费实现，不是 Wren、Cells 或 WeKnora 的认证、工作流、原生 UI
及实际业务部署验收。未发送模型或真实组件调用，未修改 `.references`。Wren
完整 UI `c5f02a0391c87420dba78632dcd86073710deb72` 与 engine
`47ca29ebba291100ba5d70ce1790f9887eaed7a0` 的 stdio 工具入口不能与此前
`871118e94f1525c401d867074c05e7e8eefca1cc` Python v2 runtime 混配；本实现
没有任何 Wren 工具名或版本专属分支。

实现后仍使用上述固定 SDK、4 CPU/8 GiB、无额外 swap、Cargo jobs=16 和原 Data
缓存。独占隔离库 `protocol_peer_tm8mte` 的原 80 条迁移全部向前执行成功；
未使用业务库。原 `cargo test -p platform-core --bin platform-core --offline`
在最终 schema 修正及变异还原后实际 186 passed、10 项既有 ignored。
其中 `peer_terminal_requires_schema_valid_result_or_explicit_native_error` 直接调用
写审计前的生产判定，验证空/多块/schema 不符不生成确定业务终态。
同一批 `cargo fmt --all`、原 Core 检查与
`cargo clippy -p platform-core --all-targets --offline -- -D warnings`
最终整体退出 0；Clippy 实际退出 0。完整恢复日志 `peer-final-restored.log`
SHA-256 `40d1b401a4e3b5e1cf5ca99252726a1a707715ae411ce83b41425db00b034d52`。

同批生产变异移除 peer 的 quota NONE 守卫，并使 PEP 从原包装而非已批准值重建；
原 Core 检查实际 183 passed、2 failed、10 ignored，退出 101，两个失败精确命中
这两处守卫；两源逐字还原后才执行上述恢复检查。原日志
`peer-mutation.log` SHA-256
`0f52e8bdb8d24218eec14353ba3193b6ffe23d406644a374ea850e7b819b127a`。

Worker 使用原 `go test ./activities ./workflows -run "Component|ProtocolPeer" -count=1`
及 `go vet ./...`，均退出 0。真实 Activity 消费检查的六场景包括成功、丢回执、
虚构 native job、缺协议结果、reconcile 和错误 Workflow；不是另写模型逻辑。
移除生产 reconcile 拒绝条件使原场景实际失败、退出 1，逐字还原后两包通过。
原件 `peer-go-native.log` SHA-256
`4d4c64264da1d0734b0a373fd2a362f05606b1bf12c2fa335619ac5a89c85d8c`，
`peer-go-mutation.log` SHA-256
`44dbe8226305ee62e77d8d461bbe843ff2377bb8dc4c3814eac97691cf086c3b`，
`peer-go-restored.log` SHA-256
`927a79b7548682cec29c1eb089ccec647ab530cc2787a85808cfcb6debb04f77`。

首次 PATH 缺 Cargo、私有缓存请求不存在的 reqwest 版本、测试 Content 类型错、
旧隔离库缺审批列，以及 Clippy 格式/参数警告均保留失败原件，修正后沿原入口继续；
Go 默认缓存触发联网失败后明确使用既有 `/cache/go-mod` 和 `/cache/go-build`，
没有修改网络或门禁。原四侧生成完成，生成 Go 经原 gofmt 归一化；最终联合生成与
完整检查由主线负责。本轮没有运行 full、产品构建、部署或真实组件/模型调用。

## DD-98 既有原生对象的 Resource 引用生产者

实现基线为 `d343a33ed491f12f60efbddfd973a1053461c8ef`；依据设计权威
`36bab8398fa22a3ef2542db384ee72a042a04174` 的 DD-98、03 Resource
与 06 RESOURCE_PROVISION。后续设计 `8d0c75ec177d7c7dd1a9183fe571f8c6cb6fa158`
只修正独立服务接缝事实，不改变此路径。这里登记的是可核验外部引用与平台授权根，
不是创建原生对象、复制正文或接管独立服务的管理权。

### 四步影响结论

1. 权威：复用原 ActionAdmission、Resource、ComponentTaskWorkflow 和 SpiceDB。
   HUMAN BFF 的 `resource.create` 消费已批准类型和 ACTIVE binding 的精确投影，
   以受控 AdapterDirectory 中的原生引用投递事实查证请求；不是接受浏览器自述通过。
2. 影响：ActionCommand 的可选 `resourceCreate`、原 Params/Semantic、目录动作曝光、
   Workflow kind、Core service advance、Worker 分派、Resource 原表及四侧类型。
   Workflow input 冻结原 AE、Resource 准入版本、binding/version/release/generation、
   native instance/scope 和证据引用；未登记新 Workflow 类型或第二资源目录。
   17000 迁移遇既存无 provenance 的业务 Resource 确定拒绝，down 遇新事实拒绝。
3. 副作用：只写平台元数据和原 SpiceDB 投影。全局 native identity 唯一约束阻止
   同原生对象通过另一 binding 获得第二 owner 根；同 owner 的重复登记复用原根。
   ACTIVE 时清除创建投影标记，让既有 APPLICATION 目标解析器消费同一个真实 Resource。
   重复登记不会重写已有根的 ACL、恢复已撤销授权或修改原生对象。
4. 异常：缺目录或缺原证据为 UNKNOWN，不推断原生对象不存在；scope/owner/版本
   冲突拒绝；确定撤权或 binding 变化先持久化清理 fence，再删除本次原投影并 FAILED。
   丢失回执、重复 Activity、ContinueAsNew 只查询原引用；结果不明不重放 native CREATE。
   原 audit terminal 回执与 Resource 终态同事务，未知状态仍通过原 Task 投影呈现。

### 交付边界

本批是 HUMAN BFF 创建引用到现有 APPLICATION Tool 目标解析的服务端生产路径。
未暴露 Agent 代发 `resource.create` 的 MCP 入口，不把设计允许代发等同已经实现。
仅消费本批已经存在的 PROTOCOL_PEER 受控原生引用投递；未伪造 Remote Adapter 的
CREATE、ABSENT_FENCED 或原生原子幂等证据。没有新增前端创建表单，Web/Desktop/Mobile
仍共享原管理 API。隔离 SQL/Workflow 证据不等同真实独立组件、SpiceDB/Temporal
联机业务验收，也不等同提交、部署或生产就绪。

ActionCommand 新字段和 ComponentTask input 的新可选分支不改变既有动作或历史
Workflow payload；新增 RESOURCE_PROVISION 只能由包含该实现的 Worker 执行。
迁移、Core 与 Worker 必须作为同一发布批投递，旧 Worker 不具备此新 kind 的执行能力。
旧 Core 的原 capability registry 仍关闭 resource.create，不因目录新增定义而开放旧入口。

### 已运行的定向证据

证据原件目录：
`/volumes/data/kailo/tmp/codex-resource-reference-20261005.8ZVGS7`。
所有工具链在既有固定 SDK 内执行，4 CPU、8 GiB、swap 0；未使用宿主 SDK。

- `bash tools/gen.sh && bash tools/gen.sh --check`：退出 0，四侧与原 Mobile i18n
  同步；`gen-frozen-target.log`。
- 原 `pnpm --filter @client-kit/contracts test`：12 项通过；原
  `dart test test/roundtrip_test.dart`：13 项通过；联合命令退出 0，
  `resource-contract-consumers-final.log`。
- `go test ./workflows ./activities -run ResourceProvision -count=1`、
  `go test ./internal/contracts -count=1`、`go vet ./workflows ./activities`：
  退出 0；Activity 包该过滤器无独立用例，不计作 Activity HTTP 联机验证。
  原 Workflow 用例实际走丢 ACK、串 Resource 回执、同冻结输入重试及 UNKNOWN 投影。
- 在生产 Worker 分支移除 `result.ResourceID == target.ResourceID`，原目标退出 1：
  `calls=2 unknown=1 error=<nil>`；逐字恢复、`cmp` 退出 0，原目标恢复退出 0。
  原件为 `resource-worker{,-mutation,-restored}.log`。
- 原隔离库 80 条向前迁移通过，17000 空事实 down/up 通过；既有
  `application-execution-dispatch.sql` 在新约束下退出 0，
  `resource-constraints-final.log`。有真实隔离 Resource 引用事实时直接执行 down
  确定拒绝，退出 3：`resource reference facts must remain readable`，未删除事实。

失败亦保留：初次 SDK 复制未完成时两次生成入口不存在，退出 127；新 SQL 夹具首轮
`resource` 变量/列名歧义退出 3，改为 exact 原 AE 标记谓词后恢复 0。首次 pnpm
定位尝试未命中离线 npm 元数据，随后原受控安装入口因复制缺少原锁文件拒绝；
补齐原字节锁文件并复用既有 `HOME/tooling/pnpm@10.33.4` 后通过，未升级或改写依赖锁。
本批未执行全量检查、产品构建、提交、push、迁移线上库或部署。

### 联合输入的实际恢复验证

上述独立源随后与 PROTOCOL_PEER、NativePage 合入
`/volumes/data/kailo/tmp/codex-application-core-worker-release-20261005.2Co1Ge/apps`。
该联合输入沿原 `tools/gen.sh` 和 `--check` 重新生成四侧及 Mobile i18n，退出 0；
不以独立分支生成物覆盖其他功能。固定 SDK 仍为 4 CPU、8 GiB、swap 0、Cargo 16。

联合隔离库 `resource_producer_8zvgs7` 的原迁移链实际为 81 条，最大版本
`20261005017000`，失败数 0；补入 16000 后才运行生产函数验证。使用明确隔离库的
`cargo test --locked --offline -p platform-core --bin platform-core`：
189 passed、0 failed、11 ignored。另显式运行
`resource_provision::tests::original_producer_freezes_one_accountable_reference`
的 `--ignored --exact --nocapture`：1 passed；该用例消费实际生产函数与原数据库
约束，事务结束回滚，不把它计作真实 BFF、Temporal、SpiceDB 或独立服务联机验收。
`cargo clippy --locked --offline -p platform-core --all-targets -- -D warnings`
退出 0。

后置反例实际修改 SDK 内生产 tenant scope 守卫，使原精确引用验证退出 101；
向真实 Resource 样例注入未定义字段，使 Rust/Go/TypeScript/Dart 原往返消费者
分别退出 101/1/1/1。未修改联合候选生产源或样例。两处逐字还原并与联合候选
`cmp` 退出 0 后，Resource 三项纯目标及单独数据库目标、Rust 11 项、Go 原
Component/ResourceProvision 与 contracts 目标、TypeScript 12 项、Dart 13 项和
Clippy 再次全部通过，恢复组合命令退出 0。

首次联合验证失败均保留：SDK 输入漏复制原 `ext_mcp.proto`，补齐既有原件后继续；
清理调用将 UUID 错转成字符串导致 E0308，修为原 `delete_resource_projection`
接受的 UUID；随后原 Automation EXPLAIN 用例继承 SDK 旧数据库连接，缺旧库列而
失败，仅读取 EXPLAIN、未写该库。改为显式投递本任务 81 迁移隔离库后通过，未修改
Automation 逻辑或真实业务数据库。

原件均在前述 `8ZVGS7` 证据目录：

- `assembly-gen.log`，退出 0，SHA-256
  `b8c5020e3810f43c5a847f77c11beab1cb63250a0f8477b65eae8c53ebb54d37`。
- `assembly-migrate.log`，退出 0，SHA-256
  `ca25e62ef17323b3f5df82c991a22f869bc828ffdfb47c00487bc7267564fd25`。
- `assembly-core-isolated.log`，退出 0，SHA-256
  `82c6bb1eed04b669f68f899c16b61c454eb4d0d06162c050816b695c4cc5ed15`。
- `assembly-mutations.log`，五项预期失败均成立，汇总退出 0，SHA-256
  `1e7fc090828a5559c1ac58859e81c265e253a1074a2ca0454c48a53c0f3da335`。
- `assembly-restored.log`，退出 0，SHA-256
  `28282633ab0310299c9b00884a426774732eec6718ea8ac8c23d30e3339403d5`。

这是联合源码的定向实现证据，不是全量检查、产品构建、发布或组件业务验收；这些
阶段仍由主线集中收口，未在此重复运行。

### 联合完整检查发现并纠正的契约遗漏

随后对冻结树 `35574485b5837899c8508d99bdd3a59ee92fb0c3` 实际运行原
`./tools/check.sh --full`。第一句柄 52205 退出 2，原因是隔离 PG 的 `none`
网络导致原 `dart pub get` 无法访问包源，尚未进入检查门禁。原 PG 无活跃连接，
尝试加入现有 bridge 被 Docker 拒绝后，没有改它的网络或任何业务容器。改用已存在、
无宿主发布端口的测试 PG 和本批专用 `resource_assembly_2co1ge`，从前述隔离库
复制并核对 81 条成功迁移；凭据沿原入口内存到 Docker stdin 投递，不写源码或日志。

同树第二句柄 59329 实际退出 1。格式、静态、四侧同步、迁移往返、SQLx、
各语言验证、Workflow replay、文档和安全检查通过，但以下问题明确没有通过：

- 私有 clone 借用的宿主 Git 对象在容器内不可见，历史契约 tag 与产物 recipe
  无法读取。仅在该 clone 执行原 `git repack -a` 物化借用对象，未删除 alternates、
  修改 refs 或改写历史。
- 14000 已按设计 03 §6 扩展 APPLICATION ActionDefinition 结果暴露值，
  `result_exposure` 契约却仍只有 NONE/READ。沿已有目录、DelegationScope 和
  ResultExposurePolicy 消费者查证后，将原封闭枚举补齐 CONSUME_ONLY/EXPORT；
  原数据库对平台动作的 NONE/READ 限制、目标权限、schema/redaction 求交保持。
  没有将声明视为授权。原四侧生成及 `--check` 退出 0，Go 原 gofmt 归一化完成。
- 两条通用组件 trace 误带 Wren 专属 DD-12，和覆盖矩阵的 EXT-DATA 归属冲突。
  移除不适用引用，保留原通用组件设计 ID，不修改阶段来迎合门禁。
- `dist` 缺 trace 引用的旧 Core/Worker 产物，补入既有发布目录的原 SBOM/provenance，
  不改历史摘要。Web/Desktop 的新 NativePage 与共享契约输入确实不同于旧产物；
  必须真实重新构建，不能只回填 source digest，因此此处仍不声称完整检查通过。

原件目录为
`/volumes/data/kailo/tmp/codex-application-core-worker-release-20261005.2Co1Ge`：
`assembly-full.log` SHA-256
`3a867f6ccda5e0e980167a56b588326b99284d44abce843311ea5ea0d134ba81`；
`assembly-full-network.log` SHA-256
`f6183f2db35f5a8c6357ee29bf326f49789f0503eaf31c258390953983ca67a3`；
`enum-gen.log` SHA-256
`b8c5020e3810f43c5a847f77c11beab1cb63250a0f8477b65eae8c53ebb54d37`。
实际部署配置预检仍因未投递 `.env` 明确 SKIP，未以隔离验证冒充运行配置验收。

### 完整原生源码入库的扫描范围复核

本批加入 knowledge/data-query 两套完整原生源码后，原
`upstream_manifest.py diff <project> --check` 均退出 0，未声明删除数为 0；
Wren 的原 gitlink 明确固定 engine commit
`47ca29ebba291100ba5d70ce1790f9887eaed7a0`，展开源码不是新写查询引擎。
纳入清单无安装依赖或运行密钥；原 Wren `tools/dev/.env` 与固定上游原件摘要相等，
不将该上游示例替代部署凭据。两套源的原 added-lines 扫描均无凭据模式命中。

实际发现旧 `step_supply` 整体排除二开目录，而 added-lines 又排除自有 `fork/`，
造成维护包装漏扫。仅在原扫描步骤使用同一模式补扫实际存在的自有 fork 路径，
不扫上游未修改的测试假密钥、不新增工具或豁免目录。实现后在已跟踪的 knowledge
证据文件短暂注入一个无效合成标记，冻结反例树后立即逐字还原；原
`./tools/check.sh supply` 真实退出 1，明确报“发现疑似凭据”，同时四个历史产物的
SBOM/provenance/commit/锁摘要检查通过。反例未进入最终源码树。
原件 `2Co1Ge/supply-fork-mutation.log` SHA-256
`535f3f00eb94302e2dbaba1fd7f1d69af789a19caa395c733ae92b7270e07d4f`，
旁置 exit 文件为 1；外层预期失败核对退出 0。原入口临时目录清理曾等待磁盘写回，
没有中断重跑。还原后的最终完整检查另行记录，不以此反例替代恢复验证。

### 原生 MCP 的绑定级凭据投递（独立后续源码批）

本增量基于上一批树 `e0f5d21ba755a6de51fc93ff976b8a493fd4bf09`，不回写主线
联合候选。依据 DD-12/58/70/71/94，复用原 SecretStore audience、OpenBao KV
固定版本与真实 audit request ID，以及原 Gateway provider-credentials 文件投递。
不同 binding/generation/secretKey 派生不同文件身份；目录只保存 SecretRef 和认证
header/prefix 映射，原路由只含受控文件引用，不含密钥值，不透传平台 Session 票。

本批只消费 `STRING / SERVICE_CREDENTIAL / FILE / restartRequired=false` 声明。
`lengthOrFormat` 使用显式 string JSON Schema，只接受 type/minLength/maxLength/pattern；
未知词汇、外部引用、DATA_KEY、环境变量投递或缺少匹配目录事实均拒绝。
准入冻结 tenant、binding、service、scope、generation、locator、version、audience；
调用与披露再次读取原 KV 固定版本、核审计及 Gateway 文件摘要。缺失或撤销不回退
其他身份。停用先撤路由并等待原在途消费者收敛，随后沿原文件退休/tombstone 链确认
删除，不销毁 OpenBao 源版本。没有新增绑定轮换动作；新 KV head 不替换已冻结版本，
新引用须通过既有治理创建/停用生命周期，不能冒称原地轮换已交付。

受限原 SDK 为 4 CPU/8 GiB、swap 总限额等于内存、Cargo jobs16，复用 Data 缓存。
实现后的 Core 凭据目标 3 项、SecretStore 原 lib 16 项、Rust 契约 11 项与 Clippy
all-targets 实际通过。Go 原契约目标退出 0，TypeScript 12 项、Dart 13 项通过；
四侧原 gen/check 均退出 0。同一 MCP 两份 binding/SecretRef 的样例不含密钥值。
移除版本核对及文件 binding 归属后，Core 两个断言失败、退出 101；移除原 audience
守卫后，真实 HTTP SecretStore 消费者失败、退出 101。逐字恢复后上述目标通过。

原件位于 Data 目录 `codex-peer-secret-20261005.NKsxUm`：`core-targeted-2.log`
SHA-256 `7aacd20d0cb205c795d15973858135a8562b89ce609364304881b3cdc66da75d`，
`mutation.log` SHA-256 `e588765f258323f099ff44ce07e705cbae309145e57bc21d92eda074d04e80a6`。
恢复批 `restored.log` 中 Core/Go/TS 已通过，但 Dart 缺执行副本锁而联网失败，整体
退出 65；复用已核同源 pubspec 的现成锁后，原离线解析和 Dart 13 项退出 0，
`dart-restored.log` SHA-256
`8365a0811669bc4b7eff295b9dd08f318a22e3fd74d7823ebb113376e13bed66`。
首次 Rust 局部空列表借用错误退出 101 的原件同样保留。

上述证据覆盖实际 SecretStore HTTP 消费、原生产投影计划和四侧编码，不是完整
OpenBao/Gateway/第三方 MCP 两账号端到端调用，也未执行真实 disable 或轮换。
线上需另有获批 release、两份受控 binding/native scope 事实、准确 SecretRef 版本、
原审计与 Gateway 投递配置，以及实际 Resource/ToolBinding 和调用授权；没有因
本批测试创建这些业务对象。未构建、部署、运行 full 或调用模型。

### APPLICATION 模型接缝：独立源码批的实现与验证边界

本增量基于 `306aa41bdfbee661572262aba6aba68cf095ef39`。关联 DD-20/21/92、
设计 03 的 ApplicationBinding 与 UsageEvent、07 §6.3/§10；下列是已写入实现的
变更说明，不是运行验收。当前没有提交、发布、部署或发出新的模型请求。

1. 权威：模型路由继续是原 `llm_route`/AgentGateway ConfigResource；配置由独立
   服务管理。binding 只冻结获准的 route/meter 引用、自己的 SERVICE 和 generation。
   不借 AgentInstallation 身份，不写组件模型数据库；SELF_MANAGED_MODEL 尚未开放。
2. 影响：原 binding create/advance/disable 消费 `modelGateway` 配置；原 Core
   服务端入口核已认证 Gateway Claims、scope、fresh route/Quota 和审计。既有原生
   API key、usage_dispatches 与 usage outbox 增加绑定身份关联，不建第二模型目录或账本。
   四语言 schema 同源生成；原 Agent `prepare_turn`、AE 锁、trace 意图和 native RPC
   顺序未修改。绑定无 trace 时归原 generation 的创建 operation，不伪造 Invocation。
3. 副作用：Gateway 原 ConfigResource 行与 usage_dispatches 在同一原数据库事务中
   核验、写入；先撤 key 则新 dispatch 拒绝，先 dispatch 则留下不可跳过的 pending。
   Core 21000 扩展原投影与 outbox 约束；原生 PostgreSQL 新增 0004，不改历史迁移。
   SQLite 使用原库事务增加可空身份列。旧 Agent 行保留，旧未闭合请求不能证明零用量。
4. 异常：丢 ACK 不重建 key、不重发模型请求；disable 必须见原生 key 撤销、完整
   dispatch/completion 集合、原 OpenMeter stored_at 后才关闭。空集合仅在原生撤销
   证明成立时可收口；缺数量或 token 字段不填零。可选 trace 只能定位真实同 binding
   child/operation；来源不明不能借另一 Agent 的同 trace 用量。

固定上游证据为 `.references/agentgateway` 的完整 commit
`1f7ebbf87cbdbe9517f6f181221879d04dc50692`：
`agentgateway/crates/agentgateway/src/http/apikey.rs::Claims`、
`APIKeyAuthentication::apply` 提供已认证 API key metadata；
`agentgateway/crates/agentgateway/src/http/ext_authz.rs::ExtAuthz::check_http`
提供原生 HTTP/CEL ExtAuthz。ConfigResource 与 durable usage dispatch 是既有 Kailo
二开接缝；本次没有把它们写成上游原生已有的能力。

已实际执行原 `./tools/gen.sh` 及 `./tools/gen.sh --check`，句柄 91372 退出 0，
Rust/Go/TypeScript/Dart 与 Mobile catalog 同步通过。执行使用原 SDK 4 CPU/8 GiB、
无额外 swap、Data 缓存和离线 npm；日志
`/volumes/data/kailo/tmp/codex-application-model-20261005.Qzf1iT/gen.log`，SHA-256
`b8c5020e3810f43c5a847f77c11beab1cb63250a0f8477b65eae8c53ebb54d37`。
首次机械导出因私有 sparse checkout 缺少六个 TS 契约路径失败，未执行生成；完整导出
后才运行以上成功命令，未伪造缺失文件或修改生成工具。

隔离库 `application_model_qzf1it` 已运行原 83 条迁移，up 与原 down/up 均退出 0，
读回 `83|20261005021000|0`；不触业务库。原 Core 模型目标 3 项（含实际数据库约束、
保留事实时拒绝 down）与用量目标 12 项通过。首轮编译的两个字段部分移动错误已修；
首轮 Clippy 的一处布尔表达式告警已修。原完整日志保留于同 Data 目录的
`core-check.log`、`core-targeted-restored.log`、`migrations-up.log` 和
`migrations-roundtrip.log`。之后共享 target 命中了别的私有候选 contracts 缓存：
本树已生成的类型被误报缺失，同时要求本树没有的字段；原失败输出保留
`core-stale-contracts.log`，仅清理 contracts 包缓存，未修改契约迎合错误。

撤销运行期 ExtAuthz 配置不能绕过本次准入：原 Gateway HTTP 成功分支只在与该 key
冻结策略完全一致且未缓存时留下请求内证据，原 provider dispatch 消费这份证据与
同一 key 身份；缓存 Allow、不同服务成功或缺策略均不构成证据。不新增持久化
准入权威。HUMAN 的非空 trace 按原 AE operation 与同 EE/binding/generation 查证，
不借 AgentInvocation，也不把未知 trace 默默降级；主线 HUMAN 调用点另有精确增量，
需与已交付的人类动作一起编译，不能以旧基底本模块通过替代。

恢复批句柄 49371 实际退出 0：Core 模型 3 项、用量 12 项、Clippy all-targets 与
Rust 契约 roundtrip 13 项全部通过，原件 `core-final.log`；未将过滤为零项的其他
集成测试算作通过。Gateway 编译、其余三侧 roundtrip、生产守卫破坏还原仍在收口；
全量检查未运行。
运行投递还需要原 OpenBao Agent 的受控凭据文件与服务自身模型配置；没有以新 API
回传 Core audience 的 Secret，没有以本批源码声称 WeKnora 模型或工具调用已经可用。

联合输入已改为 `lciVUS/apps` 当前真实 schema 与 HUMAN/ProtocolSession 消费者。
原 gen/check 句柄 67737 实际退出 0，四语言和 Mobile catalog 全部同步；六个生成
文件回投逐项 cmp 退出 0，`ApplicationModelAdmission`、`protocol_session_id` 与
`document_launch` 同时保留。真实产物 SHA 在同 Data 目录 `union-generated.sha256`。
完整执行副本的首次 tar 因 `--no-recursion` 参数位置报错，外层末命令退出 0 不能
代表归档通过；随后原归档成员集合与 Git NUL 清单一致、提取内容 `tar --compare`
退出 0，未重新导出或遗漏宿主。该问题不影响独立完整生成输入的实际 gen 结果。

HUMAN trace 的准入和用量均定位原 AE/EE；无 AgentInvocation 不是拒绝 HUMAN 的
理由。模型准入 ACCESS 采用同次 fresh 校验过的 caller AE 和其 exact Definition，
action/version/target/hash/operation/initiator 整体一致，实际 actor 仍是组件 SERVICE；
无 trace/模型发现才使用 binding 创建上下文。最初只改三个归因字段的草稿经复核
纠正，未编译、部署或作为验收证据；唯一联合实现是 `model-audit-attribution.patch`
SHA-256 `d180ee04c64ef9702e3be18ba2a0d2fb7832183bbda263fe527b88cd5378404d`。
该 HUMAN 联合调用点与审计修正仍待联合 Core 编译，不能以旧基底 49371 通过替代。
原 EE 终态后，Gateway 明确 submitted/pending/untracked 三项为 0 时，可证明该
operation 没有 trace 归属请求；未知字段不等同该证明，无 trace 的调用继续独立
binding 计量，不据此宣称整个绑定零用量。

Gateway 恢复句柄 34585 已实际退出 0：ExtAuthz 51 项、原日志存储 8 项通过，
首次列出的 5 项 PostgreSQL ignored 随后以原 `--ignored` 入口真实运行并全部通过。
`gateway-targeted-restored.log` SHA-256
`25a3359fdad02767a5584ad1bc5c27f0615a199015accb070d116e0d7e398b6b`。
测试中一个 `PolicyResponse` must-use 告警随后通过显式消费返回值修正，未抑制告警。

联合隔离库 `application_model_union_xl5agt` 原迁移句柄 42734 退出 0，读回
`85|20261005021000|0`，包含 HUMAN、ProtocolSession 与模型迁移；仅复用原约束
fixture，不触业务数据库。`union-migrations.log` SHA-256
`fa52ffd3919c782077e8f248040d7ee55a07401010e04e5c4640d832bfc6e8fa`。
原三侧消费者句柄 26830 退出 0：TypeScript 14 项、Dart 15 项、Go contracts 通过；
复用既有固定 SDK 的依赖与 lock，无新安装。`union-wire.log` SHA-256
`832002554eb118e0d7a503eefe86124ec5d5f2396a82ec79129a661aadbe0df5`。
联合 Core 前置失败原件保留：HUMAN 增量格式差异、直接 rustfmt 使用错误 edition、
误用该二进制包不存在的 `--lib` 目标；均未当作编译通过，随后回到原 cargo fmt 与
cargo test 入口。生产守卫破坏还原和联合 Core 结果另按真实终态记载。

联合 Core 44949 实际编译成功；原测试 216 passed/22 ignored/1 failed，唯一失败为
Automation 原 SQL 的字段缺失。查证是执行时只覆盖 APPLICATION 专用数据库变量，
遗漏通用 `DATABASE_URL`：SDK 默认仍指 57 条迁移的 `scope_verify`，对应列确实不存在。
本次隔离库 `application_model_union_xl5agt` 是 85 条迁移，列实际存在；迁移终态
21:34:29 UTC，Core 测试结果 21:37:36 UTC，不是迁移竞态。未修改 Automation 源码。
显式投递专库后，句柄 4904 复用同一已编译 binary 执行原单目标，1 passed/退出 0；
`union-automation-sql-restored.log` SHA-256
`4b0375689e2a645f2bd5ec643de50d105dc5a545faddedf2d1ab0bbc2bdc36f7`。
错误库的失败保留，不把它记为产品缺陷或抹为整组 0。

联合 Core 定向恢复句柄 90079 实际退出 0：模型 3 项与 HUMAN 2 项（包含原生产
函数、85 迁移专库与原约束 fixture）通过，Clippy `--all-targets -- -D warnings`
通过，Rust 契约 roundtrip 13 项通过。过滤为零项的集成目标未算成通过。
`union-core-targeted.log` SHA-256
`626523d6944628bba824dda12d9a0e9d5f19da51ada0f3a3081788215d07863e`。
此次使用联合 HUMAN/ProtocolSession 输入与完整 caller 审计元数据版本；机械格式
修正已按窄 hunk 回投 lciVUS，并逐项 cmp 与执行副本一致。未运行本批 full、未
部署模型接缝，未以这些本地证据声称原生组件模型调用验收完成。

Gateway 生产守卫反例句柄 87899 已结束：移除 exact ExtAuthz 策略比较、SQLite
以及 PostgreSQL 的 `deleted_at IS NULL` 守卫后，三个原消费者目标分别真实断言
失败，退出码均为 101；不是编译错误导致的假反例。反例 harness 确认三个预期失败
后退出 0，`gateway-mutation.log` SHA-256
`3e355a18e54ab09171f70902db1c1712d814f37935c78b209b334081c0196e0a`。
三处生产源码已 apply_patch 还原，逐字 cmp 与反例前及 lciVUS 一致；恢复目标
10506 仍需按真实终态记载，未提前把还原测试计为通过。

输入比对句柄 8391 已结束：在原选定 Core/contract 输入范围，当前 lciVUS 相比
本次执行副本新增两份运行时源码 `agent_task.rs`、`agent_task/receipt_tests.rs`，
两份原验证文档和 Gateway 测试 must-use 修正；10 处上游符号链接的链接文字相同，
不能把 cmp 跟随悬空/目录链接的输出当源码漂移。90079 的通过不覆盖随后合入的
20db 运行时增量，后者由其原验证和最终联合 full 消费；未重复导出完整仓库。

Gateway 恢复句柄 10506 实际退出 0，`application_` 原目标 4 项通过：三个对应守卫
及一项原日志指标目标均成功，真实 PostgreSQL 目标未跳过，must-use 告警不再出现。
`gateway-guard-restored.log` SHA-256
`94dc38be5cc531394b4eea4f9da6ce2e5419ba3914165d96adaec4c6cc8566c6`。

网关产物阶段获明确授权后按原 `tools/build-upstream.sh model-gateway` 执行，唯一
候选是 lciVUS；固定 `kailo-core-data` 8 CPU/16 GiB、Data 缓存，22:15 UTC 预检
690 MiB/16 GiB、host 可用约 38 GiB、memory PSI 0。仅取 sole `.env` 的非密
REGISTRY_HOST，未 source 整份环境或投递业务凭据。预备锁回执曾误引用不存在的
`ui/package-lock.json`，在 helper 调用前退出 1，未开始构建；随后按实际
`ui/pnpm-lock.yaml` 记录，未修改锁。原 helper 句柄 19813 已启动，日志在
`/volumes/data/kailo/tmp/codex-component-runtime-integration-20261005.lciVUS/application-model-gateway-build.log`；
镜像摘要与发布状态只在实际终态后登记，不以构建启动声称完成或部署。

上述 Gateway 19813 随后实际退出 0，原 helper 完成构建、推送和来源登记：
source `sha256:be117e45670e9870f93b4e73d5f99bd3ceec58da822c034f9978fa0adbf3ce1b`，
artifact `sha256:442349136506fdb51f1feb5958a63c7d2cfda65cf194fa6e3774d3189c6dd420`。
原 registry v2 独立读回 HTTP 200，响应摘要及 manifest 正文字节摘要均一致。
日志 SHA256 `d3d69442e4601e0dc42a75cada302521d29aed8508cc3d0cde36a3a11a0143ec`；
完整回执为同目录 `application-model-gateway-build-receipt.md`。这是构建与推送完成，
不是 Gateway 部署或组件模型调用线上验收。

2026-10-06 联合 Core 输入包含随后合入的 HUMAN、模型凭据交接、Workflows
manual/delete 和运行时取消，并消费 66311 原四侧生成结果。45313 首批 workspace
测试通过（Core 225 passed/27 ignored、contracts 14、SecretStore 17），两个独占
隔离库各 87 条迁移、失败 0，22000/23000 down/up 通过；随后 ignored 模型目标因
执行命令遗漏原 `application-execution-base.sql` 而触发 tenant 外键拒绝，整批退出
101。未修改产品、测试或 FK；补执行原既有 fixture 后，69327 实际退出 0：模型
1、HUMAN 1、manual 5、management 13、receipt 8 项通过，workspace Clippy 与
SQLx prepare --check 均通过，保留原 potentially-unused-query 提示。

仅执行副本移除 `parse_action_command` 的 manual 原始参数守卫，40767 原目标
首先在 assetId 拒绝断言失败，退出 101；逐字恢复后 37425 fmt 与原目标 1 项通过，
748 个固定输入哈希全部恢复一致。本轮业务源码净变化为 0，不重复已有 workspace
测试，不把 fixture 输入纠正记为业务修复，也不将定向结果替代最终 full 或部署。
完整命令、失败和日志摘要见
`/volumes/data/kailo/tmp/codex-component-runtime-integration-20261005.lciVUS/core-union-20261006.1GeV2Z/handoff.md`，
回执 SHA256 `101cd1d39871249d4a8a8e49d7e243c5026ccd5179d584b09e82fbe6797a1676`。

### 2026-10-06 可选 Gateway SERVICE 部署回归

1. 设计与来源：DD-105 的独立 Gateway SERVICE 与 Tool Session 沿原十五项
   全缺省/完整组边界；DD-92 APPLICATION 模型继续原 Core PEP。基于
   `b9d64ad70ec0079853520faf7ab1ea4bb9830657` 的独立修复，不改变在途 full
   `d2f33b12` 或 release `b9d64ad7` 输入。实际 `.env` 全缺省时原 Compose
   `config --quiet` 退出 1（签名文件必填），证明可选能力被错误提升为平台前提。
2. 影响：只改原 Compose、start-core、init-local、Gateway YAML、配置说明及
   既有 security 检查。原 PYGATEWAY 校验后派生非密 runtime YAML 与 Compose
   overlay；原初始化 start-core→Gateway 顺序实际消费。全缺省清除旧派生签名及
   具名 listener；完整组按同一 Tool URL/name 投递原生 gateways，仅私网端口，
   不发布宿主入口。冲突端口读取原 binds、adminAddr 与 MODEL 配置。
3. 副作用：派生 YAML 为 0444，以供原镜像 UID 65532 读取；overlay 为 0600，
   私钥权限与所有权不变，不读出或复制私钥。base APPLICATION conditional
   extAuthz 的 deny 保留；没有 SERVICE 投递就不能取得 Core 授权。仅有具名
   gateway 的 port 不产生工具或后端；仍由治理 traffic.route 的精确路径、Session
   strict 与 MCP guardrails 控制。配置变更需要原部署流程重建 Gateway；
   start-core 仍只重建 Core，不偷偷重启其他服务。
4. 异常与证据：原 producer 后置检查覆盖完整组、关闭清理、部分组、过长 TTL、
   共用 Worker 身份和四类端口冲突，最终退出 0。只在隔离执行副本删除部分组
   `exit 2`，同一原检查真实断言失败退出 1；逐字恢复 cmp 0 后通过。
   `producer-mutation.log` SHA256
   `1430a0a1a6673d3398c5a5519eb99bd5b0b2fab9976a1f5070e8526ccb8c352a`；
   `producer-final.log` SHA256
   `11d2cd551d6fedfc0ac813f1d3d2cd18b7852eab0b70fdc15edc91b597cb2deb`。

实际新 Gateway `44234913` 镜像以原 UID 65532、4 CPU/8 GiB、只读配置执行
`--validate-only`，全缺省通过。首次测试输入漏隐式 cookie、隔离网络无法读取
OIDC discovery，以及旧运行环境缺新增 BFF 两非密字段，均保留真实失败；补齐
测试输入并仅只读现有 IdP 后退出 0，不修改产品来迁就测试。
`native-default-complete-input.log` SHA256
`30b214deb6985d939861f68d0a9030e21a70be6dc8180cfe440641736228e5ee`。

原 native `get_effective_config`/`materialize_config` 在环境展开前读取 YAML，
故不能将 JSON map 直接藏在环境占位符里。此批沿原派生器生成真实 YAML 对象；
`append_traffic_routes` 原样追加 resource.value，与 Core require_route 的 exact
读回一致。base 显式 routes 空列表保证删除最后路由后的 absent 读回。
本段证明配置解析和部署消费者，不是模型推理、工具调用或组件业务 E2E。
原件位于
`/volumes/data/kailo/tmp/codex-gateway-optional-deployment-20261006.KWAiDS/`。

完整十五项以同一原 PYGATEWAY 生成原生配置；独立 SERVICE 公钥/签名文件沿
受控 OpenBao 投递，未共享 Worker 或浏览器身份。真实具名私网入口选择
`kailo-agent-tools` / `http://agentgateway:18082/`，原模型端口为 18081，
没有新增宿主端口。原镜像 UID 65532、4 CPU/8 GiB、签名卷只读执行
`--validate-only` 实际退出 0。首次 runner 漏隐式测试 cookie 退出 1，补同一
公开 fixture 后恢复；未改原生配置或私钥。实投 YAML 与已验证输入 cmp 0，
真实 `.env` 加派生 overlay 的 Compose `config --quiet` 退出 0。
原件目录为
`/volumes/data/kailo/tmp/codex-gateway-service-delivery-20261006.45u1tR/`，
`native-complete-restored.log` SHA256
`30b214deb6985d939861f68d0a9030e21a70be6dc8180cfe440641736228e5ee`。
本次没有启停 Gateway，没有模型推理或 Tool 业务请求；解析成功不代表业务授权通过。

### 2026-10-07 原生 SERVICE 同步读批次与接收写准入

1. 权威与实际调用方：沿 DD-89、设计 07 §8.2、13 §4.4，保留原
   `application_read_grant::request`、ActionExecution、Operation、SpiceDB、
   Quota 与双边 receipt。WeKnora 原 DataSourceService.ProcessSync 的
   `fileStorageConnector::FetchStream/retire` 消费 `nativeBatch`；DataSource.ID
   与 SyncLog.ID 只作外部关联。每次列表或文件读取各有稳定 key 和原 Operation，
   Core 不聚合目录、不保存列表正文、不运行第二套同步流程。
2. 影响面：在已有读 AE 下持久化独立 SERVICE 接收写 AE，同一 Operation、
   同一实际 binding 主体，但使用接收方获准的 SYNC ActionDefinition 和独立
   ActionToken。接收资源、native root、版本、generation 与参数摘要全部从
   Core 目录冻结，调用方不能指定任意原生 KB。旧显式 HUMAN/AGENT ingest
   调用方仍沿原模式；两模式互斥。`knowledge.v2` 保留原五能力并增加有实际
   native 消费者的 apply/retire 声明；历史 v1 不改。四侧契约同步新增原生模式、
   列表引用与只读终态观察；旧模式成功响应仍保留原全部字段。生成器因复用
   ContentReference 重命名生成的内部类名，未手写替代类型。
3. 副作用与异常：SOURCE listing receipt 必须绑定 Core 冻结 native root 和
   实际列表摘要，不伪造文件 VersionId。接收方每次写前走原 PEP，重新核当前
   receiver.update/delete、租户/作用域、Quota 和 SOURCE receipt；票据签发
   不是执行完成。重访已有批次时，只读返回 PENDING、UNKNOWN 或 COMPLETED，
   不更新票据、不重发写入；COMPLETED 要求双边 receipt 及既有用量结算终态。
   过期仍由原读批次对账器收敛，接收子 AE 同事务进入 UNKNOWN，不释放未知
   结果。迁移 `20261007100000` 扩展既有冻结/父子/receipt 约束；有原生接收
   历史时 down 明确拒绝，不能删除历史以回滚。
4. 实际证据：既有 4 CPU/8 GiB SDK、Cargo `-j16`，Core 原读批次过滤检查
   7 PASS/2 ignored；随后在独立 `service_native_batch_6cmb1h` 数据库实际
   执行两项 ignored SQL 检查，2 PASS。原 sqlx 向前应用 105 项迁移，再对
   本迁移 down/up 均退出 0。原 capability 注册校验 1 PASS；Rust 往返
   37 PASS、TypeScript 42 PASS、Dart 37 PASS、Go 原往返退出 0。
   原 `tools/gen.sh` 与 `--check` 均退出 0。仅在 SDK 副本破坏 UNKNOWN
   分支，真实失败退出 101（None 不等于 UNKNOWN）；原字节 cmp 0 还原，
   再编译原过滤检查 7 PASS。Rust 2021、Go、Dart 使用既有工具格式化。

执行记录位于既有
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/message-edit.AGX058/`：
`service-native-core.log`、`service-native-sql-contracts.log`、
`service-native-mutation.log`、`service-native-restored.log`。
首次 tmpfs 直接执行 gen 及 Go 测试二进制因 noexec 失败，改用 bash 执行原
生成器、Go 使用原可执行临时目录后通过，未改变产品代码迁就执行环境。

这些结果不是 SERVICE 端到端验收：隔离 SQL 检查证明现有查询与 receipt
护栏，不证明真实获批 v2 release 的 SOURCE→native parse/delete→计量全过程。
本批未注册/批准新 release、未更新在线 seed、未部署、未调用真实同步批次；
Native Go 新 Connector 尚未编译，通用 conformance 对新增原生动作尚未闭合。
未运行 full；共享 clippy 留给主线程同批模板消费者合并验证，不冒称已通过。

### 2026-10-07：原生模型预览消费精确 Resource 事实

本批按 `.design/07` §5.2、`.design/08` §6 与 DD-98 的既有身份/原生引用边界实现，
不是以某个实例登录许可替代对象权限。Wren 模型预览接入既有 HUMAN 动作后，
原 `pep_check` 回应只有 execution/operation/revision，组件无法据此核对模型或视图
是否正是该 Resource 指向的对象。Core 现在在已 fresh 授权的 RESOURCE execute
回应中返回 `targetResource`，来源为同一个 AE、Resource、ApplicationBinding 与
当前 release/generation/runtime 的真实联结，不采信调用参数中的原生对象身份。

实施后四步核对：

1. 权威：SpiceDB 决定许可，Resource 持有原生引用，binding 持有实例/scope；
   Wren 在自身原模型/视图表中重建 SQL，原 QueryService 与 api_history 保留业务权威。
2. 影响面：原 PEP schema、四语言生成物、Core PEP、共享 adapter `freshPep`、
   Wren 的查询准入与引用执行消费者。没有新表、路由、权限或执行权威；没有数据迁移。
   管理、observe、ProtocolSession 与服务读取回应不新增该字段。
3. 副作用：缺失/错误 Resource、原生 type/ref、实例或 scope 均不能执行引用查询。
   Wren 在原 SQL 之前和结果披露之前重检；已证明未发 SQL 的拒绝沿原生历史终结，
   结果不明保留原幂等键，不重新执行。Core 不存 SQL 或结果正文。
4. 边界：字段缺省保留旧 wire 形状；需要精确对象事实的新 Wren 消费者拒绝旧回应。
   原共享 adapter 的 exactKeys 曾拒绝新增字段，交叉复核已发现并修复；它现在核对
   完整五字段，并要求 execute、RESOURCE 和签名 target ID 一致。先升级兼容新旧回应
   的共享消费者，再升级 Core，最后启用新 Wren 消费者。不能声称旧 adapter 可直接配
   新 Core；未知字段仍拒绝，不放开任意扩展字段。HTTP 403/503 与原 error 分类保持。

实际验证使用原有 4 CPU/8 GiB SDK、既有缓存，没有镜像构建或依赖安装：

- `tools/gen.sh` 与 `tools/gen.sh --check`：四侧生成/同步退出 0；共享词条生成检查通过。
- 四侧新增 PEP 往返各 1 项通过，覆盖旧字段缺省及完整原生事实。只在私有副本给
  原生事实注入额外字段，Rust/Go/TypeScript/Dart 分别退出 101/1/1/1；还原后四侧通过。
- Core 原 PEP 分类检查 1 项通过；`cargo clippy --offline -p platform-core --bin platform-core -- -D warnings`
  退出 0。新 SQL 在已有隔离库执行 PREPARE/DEALLOCATE 通过；这不等于真实 PEP HTTP、
  SpiceDB、撤权竞争端到端验收。
- Wren 4 suites / 82 tests 与 TypeScript 检查通过；重试域与原生对象校验私有变异分别
  抓到 1 项、3 项失败，还原后通过。详见 `data-query/fork/verify/native-integration.md`。
- Cells 真实 execute 的共享 PEP 消费检查 15/15，通过后仍核 native read receipt；
  错字段、错目标与旧 exactKeys 的私有变异均实际失败，详见知识服务原回执。
- 原 `tools/check.sh` 的兼容逻辑对 `contracts-v0.1.0` 比较通过（281 schema、匹配 3 个
  历史 schema）；该 tag 的覆盖不能替代上述实际旧 adapter 兼容检查。

验证过程中的失败没有改产品逻辑掩盖：首次 Core 命令误用 `--lib` 退出 101，改用
该工程真实 bin 后通过；新只读容器中的生成检查退出 255、没有完整输出，不计通过，
随后在原 SDK 完整生成检查通过。首次抽取检查函数因脚本改变 cwd 得到“无 schema”
跳过，不计有效证据；回到真实工程路径后的兼容比对才计入上述结果。

日志位于既有
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/read-receipts-20261007/pep-resource-*`。
正式根目录实际执行 `./tools/check.sh --full` 退出 **2**，输出为
`容器执行拒绝：必须由执行配置提供 TMPDIR`。未完成 full 门禁；没有部署新服务或
生成安装包，不把窄验当作生产就绪。任意 SQL/describe、Asking/dashboard、全部原生
对象登记与逐用户元数据授权仍有差距，Wren 单个引用预览的完成不等于整体 Wren 完成。
