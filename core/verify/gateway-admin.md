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
