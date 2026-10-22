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
- 生产链仍受第 5 节卡点 4 阻断：一致性环境与交付目录未投递，见 [Agent 工具接入说明](agent-tool-mcp-access.md) 第 6 节。
