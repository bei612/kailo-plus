//! DD-134 网关管理区：AgentGateway 的调用统计、MCP 工具注册与实时配置只经 Core
//! 呈现与治理。
//!
//! 全部入口都是 BFF 只读查询（`01` §4：内部权威查询不递归建立 Governed Action）；
//! Core 以 SS-AGW-ADMIN 的 service 凭据读取 Gateway，浏览器从不接触 Gateway admin
//! API 或其原生 UI。修改只经既有动作；唯一新增动作 `llm_route.disable` 在
//! `model_route` 模块内实现（`05` §2.13）。
//!
//! 范围取会话 Tenant（DD-134(2)）：Platform Catalog 会话是 `PLATFORM` 范围，只见
//! Gateway 原生事实与 Tenant 归属 ID；业务 Tenant 会话是 `TENANT` 范围，按
//! Tenant/Workspace `audit` 下钻本 Tenant 的业务关联。每次请求 fresh 授权。

#[path = "gateway_admin_access.rs"]
pub(crate) mod access;
#[path = "gateway_admin_config.rs"]
pub(crate) mod config;
#[path = "gateway_admin_history.rs"]
pub(crate) mod history;
#[path = "gateway_admin_mask.rs"]
pub(crate) mod mask;
#[path = "gateway_admin_mcp.rs"]
pub(crate) mod mcp;
#[path = "gateway_admin_probe.rs"]
pub(crate) mod probe;
#[path = "gateway_admin_routes.rs"]
pub(crate) mod routes;
#[path = "gateway_admin_stats.rs"]
pub(crate) mod stats;
#[path = "gateway_admin_tools.rs"]
pub(crate) mod tools;
