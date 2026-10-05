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
