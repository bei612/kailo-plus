# 网关管理区实现与核验记录（DD-134，2026-10-22）

设计：`.design` 固定 `9b581bc326896d477a5fb3082a3761a3febbb504`（DD-134、SF-AGW-27/28、V-SCN-191–197）。
本记录只写分支 `feat/gateway-admin` 上可复核的源码事实与 CI 节点检查结果；没有构建镜像、没有部署，
不代表 full、业务验收或生产实测（生产实测待合并发布后进行）。

## 1. 实现范围

| DD-134 条款 | 实现 | 位置 |
|---|---|---|
| (1)(2) 入口与范围 | `GET /api/v1/gateway/access`：Catalog 会话为平台范围，业务 Tenant 会话为 Tenant 范围；各分区布尔来自 fresh SpiceDB 与既有动作准入预评估；Web/Desktop 导航只在至少一项可用时显示“网关” | `gateway_admin_access.rs`、`react/navigation.tsx`、`react/gateway*.tsx` |
| (3)①–⑤ 统计、调用与下钻 | 模型调用经 SS-AGW-ADMIN 的 `/api/logs/search`、`/api/logs/get`（不取 payload，丢弃 prompt 预览与 turn）；工具调用取 Core 子 ActionExecution 与审计；P50/P95 模型与工具分列；窗口默认 24 小时、最长 7 天，各扫描 5000 条，超出标 `truncated`；平台范围只按模型路由、Tenant 与时间段聚合 | `gateway_admin_stats.rs`、`react/gateway-stats.tsx` |
| (3)⑥ 实时配置与版本历史 | effective config 与 ConfigResource 列表实时读取并打码；Core 写入并回读后在 `projection.gateway_config_revision` 记写入证据（`history::scope` 声明 ActionExecution）；没有证据的当前 revision 显示 `UNRECORDED`；diff 按 RFC 6901 路径 | `gateway_admin_config.rs`、`gateway_admin_history.rs`、`model_route.rs` 的 `Gateway` 写路径、迁移 `20261021120000_gateway_config_history` |
| (4) 打码 | 键名、Bearer 值、URL userinfo/query/fragment、`backendAuth`/`apiKey` 结构、文件投递路径统一在 Core 打码，单元测试覆盖 | `gateway_admin_mask.rs` |
| (5) MCP 向导 | 交付目录与一致性环境只读（`GET /api/v1/platform/gateway/mcp/peers`）；受控探测 `POST /api/v1/platform/gateway/mcp/probes` 经临时 route、ExtMcp 只放行 initialize/ping/tools/list、结束删除并回读、`ACCESS` 审计、探测记录表；Tenant 侧可连接 release 与 binding 草稿（纯计算）；前端按序编排既有 `capability_contract.register/approve`、`component_release.register/approve`、`application_binding.create` | `gateway_admin_mcp.rs`、`gateway_admin_probe.rs`、`agent_tool_pep.rs`、迁移 `20261021120100_gateway_mcp_probe`、`react/gateway-mcp.tsx` |
| (6) 工具列表与测试调用 | 工具表按 Tool `discover` 过滤，停用只经 `application_binding.disable`；测试调用 `POST /api/v1/gateway/tool-test-calls` 以该工具登记的 ActionDefinition 准入，Core 经执行专属临时 route 调用，PEP 只放行冻结的工具名与参数摘要，结果按 exposure 只在本次回应给发起人 | `gateway_admin_tools.rs`、`application_tool_human.rs`、`agent_tool_pep.rs`、`react/gateway-tools.tsx` |
| (7) 模型路由 | 列表、`model-sources`、`llm_route.create` 既有动作；新增 `llm_route.disable`（SYNC、EXPLICIT、`TARGET_HOME_WORKSPACE`、route `manage`）：`ACTIVE→RETAINED_READ_ONLY` 后退役 Gateway 投影并回读，结果不明保持 `UNKNOWN`；binding 的模型 ExtAuthz 对非 ACTIVE route 以 `BINDING_NOT_ACTIVE` 拒绝 | `gateway_admin_routes.rs`、`model_route_disable.rs`、`governance.rs`、`application_model_route.rs`、迁移 `20261021120200_llm_route_disable` |

## 2. 生成与数据库

- 改了 `contracts/`（19 个新 api/enum schema，另有 `gateway_tool_test_call_result`）与 i18n（257 个键）：合并后须运行 `tools/gen.sh`（四侧契约与 Dart i18n），生成物未提交。
- 新增查询全部是运行时 `sqlx::query*`，不需要 `cargo sqlx prepare`，`core/.sqlx` 未改。
- 三条迁移：`20261021120000_gateway_config_history`、`20261021120100_gateway_mcp_probe`、`20261021120200_llm_route_disable`。后两条在一次性 tmpfs PostgreSQL 上做过 run → revert ×2 → run，读回 `llm_route.disable|1|TARGET_HOME_WORKSPACE|manage|resource`。

## 3. CI 节点检查（分支提交 `8c10788ed`，固定检查镜像 `local/kailo-check:7c1a6a13…`）

| 检查 | 结果 |
|---|---|
| `tools/gen.sh`（含 Dart i18n） | 四侧与 `platform_text.dart`、`reason_text.dart` 生成成功 |
| `cargo clippy -p platform-core --all-targets -- -D warnings` | 退出 0 |
| `cargo test -p platform-core --bins` | 660 passed、0 failed、59 ignored（含 gateway_admin 33 项、探测 4 项、测试调用 5 项、disable 1 项） |
| `pnpm -r typecheck`（contracts、platform） | 通过 |
| client-kit platform vitest | 122 文件、1704 项通过（`gateway.test.tsx` 16 项） |
| Web `tsc --noEmit` 与 `vitest run src/platform src/app` | 退出 0；39 文件、652 项通过 |
| `tools/check-docs.sh` 文本步骤（对固定设计） | 禁用词、设计 ID 闭合（334）、三项计数、V-SCN 覆盖、markdownlint 通过；相对链接失败只来自临时目录摆放 `../.design` |

未覆盖：Desktop 完整 `tsc`（镜像缺 Tauri 依赖，只逐项核对了 `PLATFORM_SECTION_LABEL` 与路由分支）、Go 构建、需要数据库的集成测试、full、镜像构建与部署。

## 4. 已知限制

- 平台范围不统计工具调用（工具调用是业务 Tenant 事实），平台总计只含模型调用。
- request log 的用量关联假定日志 ID 与 durable usage 的 `id` 一致；查不到时显示 `BILLING_UNAVAILABLE`。
- Tenant 删除链与 Installation 配置刷新写入 Gateway 时没有声明 ActionExecution，写入证据的归属列为空。
- 探测不投递凭据，需要鉴权的 peer 在 initialize 即失败；探测写入的临时 route 没有 ActionExecution 归属。
- 测试调用只覆盖 SYNC、无审批、契约 permission 为 discover/consume/read 且目标为 Resource 的 `PROTOCOL_PEER` 工具；需审批的返回 `CAPABILITY_BLOCKED`。
- 旧的、非 Core 写入的原生 route 被停用时只转 `RETAINED_READ_ONLY`，不删除其原生配置。
- 生产链仍受卡点 4 阻断：一致性环境与交付目录未投递，见 [Agent 工具接入说明](agent-tool-mcp-access.md) 第 6 节；部署件见同文第 7 节（分支 `feat/gw-mcp-reference`）。

## 5. 生产验收（2026-10-22，运行 cc3e7168 的 pin：core `90554300…`、worker `aa6f3f30…`、web-client `c08ca98d…`、model-gateway `c2faf443…`）

经 CI 节点 `~/kailo-acceptance/gateway-dd134/` 的脚本以真实 SSO 会话操作（playwright 截图 43 张在 `out/`，授权矩阵
`out/matrix-20261022T183725Z.jsonl`，截图已逐张打开复核；会话用完关闭）。账号：平台范围 `kailo-platform-approver`
（Catalog 会话），Tenant 管理员 `kailo-qa-1`，普通成员 `kailo-qa-2`、`kailo-qa-3`。

| 场景 | 结论 | 证据要点 |
|---|---|---|
| V-SCN-191 | 失败 | 平台范围只有 MODEL_ROUTE/TENANT，TOOL/AGENT/BINDING 返回 422；Tenant 四维度；1h/24h/7d 正常、8 天 422；模型与工具时延分列；普通成员统计/调用 403；浏览器只请求本站 `/api/v1/gateway*`。失败项：普通成员仍见“网关”入口（缺陷 3）；无状态的 request log 被计为成功（缺陷 1，本分支已修）；路由维度按模型名聚合（缺陷 2）。`truncated` 未能触发（上限 5000，7 天平台 623 条、Tenant 343 条） |
| V-SCN-192 | 部分通过 | 模型调用下钻 `model:01a153b1…`：元数据、15212 ms、8692/327 token、COMMITTED，关联 ActionExecution `015d2852…`、operation `732ffcbb…` 与同 operation 14 条审计；166 条无 durable usage 显示“计费不可用”；列表与详情键名无 prompt/turn/payload/参数/正文。工具调用下钻未验：生产没有子 ActionExecution |
| V-SCN-193 | 通过（JSON 路径 diff 未验） | 39 个资源 29 个敏感键为 `[REDACTED]`，无 bearer/userinfo/query/PEM；39 个当前 revision 为 UNRECORDED；两条测试路由的 provider/model/virtualModel 各有 rev1（`llm_route.create`）与 rev2（`llm_route.disable` 删除）证据；Tenant 管理员读 history 403；无写配置入口 |
| V-SCN-194 | 部分通过 | 未登记 URL 不发探测并显示需登记条目；POST 未登记 ref 返回 403 `CAPABILITY_BLOCKED`；交付目录“当前不可用”。探测到批准待卡点 4 部署件（`agent-tool-mcp-access.md` §7）发布 |
| V-SCN-195 | 未验 | 待部署件；Tenant 侧显示无可连接的已批准发行 |
| V-SCN-196 | 未验 | 待部署件；两个原生工具无测试入口（符合设计） |
| V-SCN-197 | 部分通过 | 经 `llm_route.create` 新建两条一次性测试路由 `8553d435…`、`f367309b…`（复用 vision-27b-uat-custom 来源）；`kailo-qa-1` 停用后直接 RETAINED_READ_ONLY、无审批，三类投影删除并回读不存在，审计 INTENT/DECISION/DISPATCH；`kailo-qa-2` 停用被拒（`b0da924f…`）；生产原 7 条路由仍 ACTIVE。被引用路由的 BINDING_NOT_ACTIVE 与回应丢失转 UNKNOWN 未验 |

缺陷：

1. 无 HTTP 状态且无错误的模型调用记为成功（`gateway_admin_stats.rs` `model_outcome`）——本分支 `20bec644` 改为 UNKNOWN 并加测试。
2. 模型路由维度与路由用量以请求模型名为键，`route_resources` 以 native_id 匹配，永远匹配不上：路由列表用量为 0，同名模型的多条路由合并，
   `modelRouteResourceId` 恒空（`gateway_admin_stats.rs` 约 553–562、651–656、733–756 行，`gateway_admin_routes.rs` 157–187 行）。
3. `gateway_admin_access.rs` 211–224 行以 Tenant `discover` 给出工具与模型路由分区，所有成员都有入口，与 V-SCN-191“普通成员无入口”冲突；需设计裁决。
4. “新建模型路由”排除本 Tenant 已用来源（`gateway_admin_routes.rs` 307–321 行），生产 5 个来源全被排除，页面无法新建；`llm_route.create` 本身允许复用。
5. 次要：平台按组织分组显示组织名而非 Tenant ID；无权成员停用已停用路由先得到 409（状态先于权限判定）；`llm_route.create`/`disable` 停在 DISPATCHED 无 OUTCOME 审计（历史 24 条同样）。

留下的数据：两条测试路由 `8553d435…`、`f367309b…` 为 RETAINED_READ_ONLY（停用不可逆）；`kailo-platform-approver` 首次进入 Catalog 时按会话 displayName 填写显示名（operation `e64de483`）。

### 5.1 缺陷处置（分支 `feat/gw-mcp-reference`，设计 `f2a2f1a2`）

| 缺陷 | 处置 | 提交 / 测试 |
|---|---|---|
| 1 无状态无错误记为成功 | 记为 UNKNOWN | `20bec644`，`outcomes` |
| 2 路由维度按模型名 | 路由键取 request log `genAi.providerName`（route 原生 ID），其次请求模型；用量、`modelRouteResourceId` 同键 | `4f44f048`，`model_route_follows_the_route_native_id_not_the_model_name` |
| 3 普通成员见入口 | 设计裁决（DD-134(2) 区级门槛，V-SCN-191）：网关管理区与区内全部只读查询要求 Catalog `audit` 或 Tenant/某 Workspace `audit`；普通成员无入口、查询 403 | `ee89a8cc`，`zone_opens_only_on_audit` |
| 4 新建路由无来源 | 来源列表只排除 route 自身投影，与 `llm_route.create` 准入一致 | `ee89a8cc`，`a_source_used_by_an_existing_route_is_still_offered` |
| 5a 平台按组织名分组 | 只呈现 Tenant ID | `4f44f048` |
| 5b 无权者先得到 409 | `llm_route.disable` 先授权后判状态（授权后的 target_gate） | `dc2a17d2`，`scope_separates_state_from_scope_mismatch` |
| 5c 无 OUTCOME 审计 | 属缺陷（`05` §2.13 审计 FULL_LIFECYCLE、`14` §4）：create/disable 结果确定时追加 OUTCOME | `dc2a17d2` |

以上均为源码与单元测试证据，生产复验待合并发布后进行。


## 6. 第二轮生产验收缺陷（2026-10-23，main `2b054bbf`）与处置（分支 `fix/mcp-token-audience`，设计 `1bd1d477`，DD-137）

| 缺陷 | 处置 | 测试 |
|---|---|---|
| 阻断：探测、binding 激活验证、release 一致性、测试调用四条管理 route 的 `jwtAuth` 要求 Core 自身 service 受众，Core 的 client credentials 令牌不带它，Gateway 以 `InvalidAudience` 拒绝（向导 503 `MCP initialize unknown`） | 专用 Core MCP 受众：Core 只在这些调用时以 `scope=CORE_MCP_AUDIENCE` 取令牌（`oidc.rs::TokenSource::core_mcp`）；管理 route 只接受该受众、`preserveToken: false`（`service_auth.rs::core_mcp_authentication`）；ExtMcp 两相以 route 元数据 `coreMcpCaller`（Gateway 已验证的 `iss`/`azp`/`aud`）判定 Core 并拒绝仍带 `authorization` 的管理请求；bearer 不再进入 ExtMcp 动态元数据。Agent 会话工具 route（`mcpAuthentication`）不变 | `core_mcp_caller_requires_issuer_core_client_and_dedicated_audience`、`management_caller_is_gateway_metadata_and_a_forwarded_bearer_is_refused`、`management_metadata_carries_verified_claims_not_a_bearer`、`scope_token_follows_rfc_6749`；Gateway `test_strict_without_preserve_strips_bearer_and_keeps_claims_for_guardrail_metadata` |
| 安全约束核实：保留的 bearer 是否到达第三方 peer | 属实。`IncomingRequestContext::apply` 把入站 header 全部复制给 target；stateless 会话清理 DELETE（以原始 parts 重建上下文）、客户端通知与合成 initialize 后的通知不经 ExtMcp 请求相位，PEP 的 header 移除覆盖不到（SF-AGW-29）。因此只给 Core 令牌加上自身受众会把它交给 peer | 设计 DD-137(3)；Gateway 现有 `apply_propagates_other_headers` 与新增 strip 测试 |
| IdP | 可选 client scope（名即受众）+ audience mapper，只以可选 scope 挂在 Core service client；`idp-declarations.py service-scopes [--verify]`，`bootstrap.sh --declare-service-scopes/--verify-service-scopes`，`release.yaml` idp apply/verify 与 `init-local.sh` 调用；模板 Core client 登记 `optionalClientScopes`（Keycloak 导入时 scope 尚不存在即告警忽略，由声明创建） | `tools/release/test_node.py::ServiceScopeDeclaration`（4 项）；CI 节点一次性 Keycloak（compose 固定 digest）实测见下 |
| `agent.version.create` 缺 OUTCOME | 派发结果确定时经 `model_route::record_settled` 在 DISPATCH 后追加 OUTCOME（`AGENT_VERSION_CREATED`/`AGENT_VERSION_CREATION_ABORTED`），结果不明只记 DISPATCH；同文件的 update/publish/retire 在准入事务内已由 `record_local_outcome` 写 DISPATCH+OUTCOME | 编译与既有测试 |
| 平台统计混入非模型请求 | 检索恒带 `listener=llm` 与 `gen_ai.operation.name∈{chat,embeddings}`（DD-134(3)①、SF-AGW-31），Tenant 范围叠加 gateway user；下钻检索不到即 `TARGET_NOT_FOUND`。生产 3 天 request log 中 191 条无 provider 的记录全部是 `GET /v1/models`（模型监听器），MCP 流量不写 request log（SF-AGW-27） | `log_search_only_counts_model_calls_on_the_model_listener` |
| 新建路由来源无法区分 | 选项显示 `模型名 · 类型 · provider 原生 ID / model 原生 ID`，选中后另列两者版本；`llm_route.create` 契约没有名称或用途字段，未加表单项 | `gateway.test.tsx`“tells apart same-named model sources…” |

CI 节点检查（提交 `9f90cc72`）：`cargo clippy --all-targets -D warnings` 通过；`cargo test -p platform-core` 694 通过、0 失败（staging 须含 `deploy/local/protocol-peers`）；model-gateway 在固定 digest 的 `rust:1.98.0-trixie` 中
`cargo test -p agentgateway --lib -- http::jwt mcp::upstream mcp::guardrails` 129 通过；client-kit platform `tsc --noEmit`（含 test 配置）通过、vitest 126 文件 1729 通过；
`python3 -I -B -m unittest discover -s tools/release` 59 通过；`tools/check.sh lint`、`security`、`docs` 通过；`trace` 只有 dist/ 发布证明缺失项，与 main `2b054bbf` 在同一环境的结果逐行相同；`seam` 报 model-gateway、web-client、desktop-client 源码摘要变化（本分支改了其输入，需重建），data-query 上游不可达为环境问题。

一次性 Keycloak（`quay.io/keycloak/keycloak@sha256:9409c59b…`，模板渲染、测试值）：导入时 `Referenced client scope 'kailo-core-mcp' doesn't exist. Ignoring`；`service-scopes --verify` 报 DRIFTED 且不写；声明 `changed=3`；重跑 `changed=0`；回读 DECLARED。
Core 不带 scope 的令牌 `aud=gateway-admin`；带 scope 的 `aud=[gateway-admin, kailo-core-mcp]`、`scope=kailo-core-mcp`；Worker 申请该 scope 得到 `invalid_scope`。

已知限制：管理面受众仍由 Core client 的 client 级 mapper 恒签入，专用 MCP 令牌同时带它，直到 DD-137(5) 的收窄（管理面令牌改按 scope 申请并在已部署与回滚目标都升级后移除 client 级 mapper）；在此之前由 `preserveToken: false` 保证它不离开 Gateway。`agent_definition.rs` 的 create/owner transfer 异步派发同样只写 DISPATCH，未在本分支处理。
