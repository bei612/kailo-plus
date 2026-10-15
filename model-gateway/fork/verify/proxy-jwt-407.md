# jwtAuth 读取 Proxy-Authorization 时以 407 拒绝

## 改动

上游对 basic auth 已按 RFC 9110 区分：凭据位于 `Proxy-Authorization` 时以
`407` + `Proxy-Authenticate` 拒绝（`http/basicauth.rs`、`proxy/mod.rs`）。jwtAuth 失败
原先一律 `401`。本仓库补齐同一语义：

- `http/jwt.rs::Jwt::is_proxy_location` 暴露令牌位置是否为 `Proxy-Authorization`；
- `types/agent.rs::JwtAuthentication::apply`（非 MCP 路径）据此产生
  `ProxyError::JwtProxyAuthenticationFailure`；
- `proxy/mod.rs` 将其映射为 `407`，并带 `Proxy-Authenticate: Bearer`，不带 `WWW-Authenticate`。

MCP 认证路径与令牌位于 `Authorization` 的既有行为不变。

## 为什么

原版 call_webhook 经出站网关实例发出（.design/06 §9.1，`deploy/local/automation-egress-gateway.yaml`）。
Core 以 `407` 判定"网关拒绝了 Core 自己的令牌、请求未离开平台"（`core/.../agent_task/call_webhook.rs`），
其余状态码都按目标的真实响应记录。若网关以 `401` 拒绝，Core 会把未送达误记为目标返回 401。

## 证据

`http/jwt_tests.rs::test_proxy_authorization_failure_returns_407`：严格模式下无效令牌经
`Proxy-Authorization` 被拒，响应 407、带 `Proxy-Authenticate: Bearer`、无 `WWW-Authenticate`。
