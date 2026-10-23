# Desktop：退出结束应用 WebView 中的 IdP 会话（DD-133(6)）

权威：`.design/07` §4.7.5「Desktop」与 §4.7.2、`02` DD-133(2)(6)、V-SCN-219（design-authority
`bc6cb109601cafab42a5ab55055ec649e968612f`）。

## 背景

Desktop 以系统浏览器登录（RFC 8252，`platform/oidc.rs::sign_in`），该 IdP 会话不在应用 WebView 中；
组件 iframe 静默登录（`prompt=none`）依赖的 IdP 会话只由原生认证窗口在应用 WebView 中建立。原退出
（`platform/api.rs::NativeSession::end_session`）只撤销 Core PlatformSession 与原生 client 的刷新
令牌（RFC 7009）：刷新令牌撤销只摘除该 client 的会话，不结束另一会话，也不触发 IdP 对组件 client
的 back-channel 退出，组件会话因此在 Kailo 退出后继续有效。

## 改动

- `platform/native_auth.rs::platform_authenticate_native_page`：保留 descriptor 的 fresh 授权、
  origin 与登录代际校验；窗口不再装载组件页，而是以原生 public client 在应用 WebView 中走授权码 +
  PKCE S256（`oidc.rs::embedded_authorization`，`state` 校验，`scope=openid`），回调
  `http://127.0.0.1/kailo/embedded-sign-in` 在 `on_navigation` 中被拦截（不加载、不监听），窗口只
  允许导航到 issuer origin。`EmbeddedAuthorization::exchange` 换令牌后只交回 ID token，访问与刷新
  令牌丢弃且不撤销（撤销会在会话中没有其他 client 时让 IdP 删除整个用户会话）。ID token 经
  `NativeSession::store_embedded_hint` 存入 OS keyring 条目 `platform-embedded-id-token`（与刷新令牌
  同一 secret store），只在打开窗口时的登录代际仍有效时写入，新值覆盖旧值。用户自行关窗仍按原语义完成。
- `NativeSession::end_session`：Core 撤销与刷新令牌撤销之后，取出并删除退出提示；有提示时以
  `oidc.rs::end_session_url`（discovery 的 `end_session_endpoint`，须在 issuer origin，带
  `id_token_hint`、`client_id`、`post_logout_redirect_uri=http://127.0.0.1/kailo/signed-out`）交给
  `LogoutBrowser`。应用实现 `native_auth.rs::WindowLogoutBrowser` 是不可见、不聚焦、不进任务栏、拒绝新窗口
  的 WebView 窗口：`oidc.rs::logout_navigation` 只放行 issuer origin，到达被拦截的回跳地址即确认，其他
  任何地址或 15 秒（`SIGN_OUT_CONFIRM_TIMEOUT`）未到达即未确认并关闭窗口。`SignOutReport` 增加
  `embedded_idp_session_ended`：确认结束或本无提示为 true；IdP 未公布端点、窗口未确认、提示读取失败为
  false。没有部署配置的本机退出同样删除提示，提示存在过即报告 false。
- 前端：`client-kit/ts/platform/src/native.ts::signOutReport` 读取 `embeddedIdpSessionEnded`（非布尔即
  false），`NativeBootstrap` 三项都确认才不显示“服务器未确认”的说明（沿用既有文案）。
- IdP：`deploy/local/identity-provider/realm.json` 原生 client 登记
  `post.logout.redirect.uris=http://127.0.0.1/kailo/signed-out`；既有 realm 由
  `bootstrap.sh --sync-client-redirects`（同步模板声明的 attributes 键，原生 client 在其范围内）收敛。
  回调地址已被原有 `http://127.0.0.1/*` 登记覆盖。
- 窗口不授予 IPC：`capabilities/default.json` 只列 `main`，未改动；CSP 不涉及（顶层窗口导航）。

## IdP 行为依据

Keycloak `services/src/main/java/org/keycloak/protocol/oidc/endpoints/LogoutEndpoint.java::logout`
（上游 main）：有身份 cookie 时以 cookie 会话为准，其会话与 `id_token_hint` 的 `sid` 不同则强制显示确认页；
没有 cookie 时取提示中 `sid` 的会话；有效提示、无需确认时直接结束会话并重定向到登记的
`post_logout_redirect_uri`。本实现让 WebView 中唯一由 Desktop 建立的会话与提示同源，因此正常路径不出现
确认页；出现时不可见窗口无法前进，按超时报告未确认，不自动确认。该行为未在本仓库固定的 Keycloak 镜像上
实测。

## 证据

- `platform/oidc.rs` 测试：`embedded_sign_in_uses_the_intercepted_loopback_and_keeps_only_the_id_token`、
  `embedded_sign_in_without_an_id_token_is_a_failure`、
  `end_session_url_carries_the_hint_and_the_intercepted_return`、
  `logout_navigation_confirms_only_the_intercepted_return`。
- `platform/api.rs` 测试：`sign_out_ends_the_webview_idp_session_with_the_stored_hint`、
  `an_unconfirmed_idp_end_session_is_reported_and_the_hint_still_goes`、
  `a_late_hint_cannot_outlive_sign_out_or_a_new_login`；既有用例以“无提示不开窗口”的假实现运行。
- `client-kit/ts/platform/test/bootstrap.test.tsx`：WebView IdP 会话未确认、旧形状缺字段均提示未确认。

## CI 节点执行结果（2026-10-22，固定 `f0d3a1fb6defd7617289f87847b2815ec8169e0e`）

在 CI 节点 NVMe 临时目录、检查镜像 `local/kailo-check`（容器内经依赖代理安装 webkit2gtk-4.1 等 Tauri
系统库，`collaboration/rust-toolchain.toml` 的 1.95.0）中执行：

- `rustfmt --edition 2021 --check` 五个改动文件：全部 0。
- `cargo test --lib platform::`：21 passed、0 failed、1 ignored（既有端到端用例）。前提：主干的
  `src/events.rs:258` 测试代码对 nostr 0.44.7 的 `EventId::from_hex` 传 `String`，`--lib` 测试目标在
  `origin/main` 上即不能编译；只在容器副本中改为 `&"11".repeat(32)` 后运行，该修正未提交。测试必须在
  没有 `HTTP(S)_PROXY` 的环境运行（假 IdP 在 127.0.0.1，代理会截走回环请求）。
- `cargo clippy --lib --tests`：退出 0；8 条警告全部位于既有文件（`commands/custom_emoji.rs`、
  `commands/messages.rs`、`commands/profile.rs`、`events.rs`），改动文件无警告。
- `client-kit/ts/platform`：`pnpm -r typecheck` 0；`pnpm test` 126 个文件 1728 项全部通过。
- `collaboration/desktop`：`tsc --noEmit` 0；`biome check` 三个改动的测试辅助文件 0；
  `pnpm test`（node 测试）2483 项中 58 项失败，与 `origin/main` 同一环境的失败集合逐条相同（无新增）。
- `web-client/web`：`npm run typecheck` 0。
- 未运行：Playwright 桌面 e2e（`tests/e2e/platform-pages.spec.ts` 仅改夹具形状）、Windows 打包。

仍未覆盖：真实 Tauri 窗口的导航拦截、Keycloak 实例上的 end-session 与组件接收端 back-channel 投递、
Windows 11 安装包实测（V-SCN-219 业务验收）。改动使 `desktop-client` 的 `source_digest` 失效，需按原
入口重建并回填 `fork/upstream.yaml`。
