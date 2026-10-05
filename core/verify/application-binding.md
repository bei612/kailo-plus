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
