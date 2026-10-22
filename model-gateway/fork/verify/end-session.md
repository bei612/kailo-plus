# SS-AGW-END-SESSION：浏览器 logout 的 RP-Initiated Logout

## 改动

固定基线 `1f7ebbf87cbdbe9517f6f181221879d04dc50692` 的浏览器 logout
（`http/oidc/browser.rs::OidcPolicy::handle_logout`）只清本地 session 与 transaction cookie，
并以 303 回到本地落点；discovery 文档（`http/oidc/local.rs::OidcDiscoveryDocument`）不读取
`end_session_endpoint`。浏览器会话 cookie 中已保存 ID token 原文
（`http/oidc/session.rs::BrowserSession.raw_id_token`，`callback.rs::handle_callback` 写入）。

本仓库在同一 logout 路径上加入可选的 OIDC RP-Initiated Logout（`.design` DD-133(6)）：

- `OidcLogout.end_session`（配置键 `logout.endSession`，缺省 `false`）。开启时 discovery 必须提供
  `end_session_endpoint`，否则配置编译失败；显式 provider 模式没有该端点，开启即拒绝。
- `OidcPolicy.end_session_endpoint` 只在开启时取值。
- `handle_logout` 的方法与同源 `Origin` 检查不变，cookie 照原样清除；之后
  `end_session_location` 只在请求带本 policy 能解开且 policy id 相同的会话时，
  以 303 指向 `end_session_endpoint`，带 `id_token_hint`、`client_id` 与
  `post_logout_redirect_uri`（回调 origin 加 logout 落点）。没有会话、cookie 伪造或属于其他
  policy 时仍回本地落点。`no-store` 不变。
- 不保存或转发 access/refresh token，不新增端点；ID token 只在浏览器顶层跳转中交给 IdP 一次。
- `schema/config.json`、`schema/config.md` 同步 `endSession` 字段（xtask 生成形态）。

## 部署

- `deploy/local/model-gateway-config.yaml` 的 listener 级 logout 开启 `endSession`，落点 `/app/`。
- IdP 浏览器客户端登记 `post.logout.redirect.uris = ${PUBLIC_ORIGIN}/app/`
  （`identity-provider/realm.json`，既有 realm 由 `bootstrap.sh --sync-client-redirects` 同步；发布 deploy 按配置摘要自动执行，ADR-20 §8）。
- Web 以顶层表单 POST 提交 `/logout`（`web-client/web/src/platform/bff-client.ts::signOut`），
  CSP `form-action` 只追加 OIDC issuer 前缀（`WEB_IDP_END_SESSION_SOURCE`）。
- IdP 结束会话后按组件专属客户端的 back-channel 配置（`bootstrap.sh --declare-native-client-profiles`）
  通知组件，接收端规格见 `.design/07` §4.7.5。

## 证据

- `http/oidc/tests.rs::logout_ends_the_provider_session_only_for_a_decodable_session`：有效会话 → 303 到
  end-session，三个参数逐一核对，本地 cookie 仍被清除；无会话、伪造 cookie、他 policy 会话 → 本地落点；
  跨源 POST 仍被 CSRF 拒绝；未开启时不跳 IdP。
- `http/oidc/tests.rs::end_session_requires_a_discovered_end_session_endpoint`：discovery 提供端点时取用，
  未开启时为空，显式 provider 开启即配置错误。
- 既有 `browser_login_and_logout_flow` 不变（未开启时行为与上游一致）。

## 运行结果

提交 `a2b5ca2f68fc5bbb8ff09622158988d15fe6f5f0` 在 CI 节点按 commit 从 GitHub 取出的
`model-gateway` 子树中执行（宿主 Rust 1.98 工具链、`--profile ci`、`CARGO_INCREMENTAL=0`）：

```bash
cargo fmt -p agentgateway --check
cargo test --locked --profile ci -p agentgateway --lib http::oidc
cargo xtask schema   # 再与提交中的 schema/ 目录逐文件比较
```

- `cargo test`：`21 passed; 0 failed`（含上述两个新用例与既有 `browser_login_and_logout_flow`）；
- `cargo fmt --check`：`http/oidc/` 与本次改动的 `types/local.rs` 片段无差异（报告的差异只在既有的
  `ext_authz`、`telemetry/log_store*`、`proxy/*` 与 `types/local.rs` 其余位置，非本次改动）；
- `cargo xtask schema`：重新生成结果与提交中的 `schema/` 一致。

日志：CI 节点 `/volumes/data/kailo/ci/tmp/claude-platform-embed/gw-a2b5.log`。改动使
`model-gateway` 的 `source_digest` 失效，需按原入口重建镜像并回填 `fork/upstream.yaml`；
IdP 侧的端到端退出联动尚未在部署环境验收。
