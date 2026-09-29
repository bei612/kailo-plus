# SS-AGW-OIDC 边缘核验：会话 cookie 与 CORS

对应 `apps/docs/acceptance/stage-1.md` §2 中 `SS-AGW-OIDC` 的缺口「cookie 前缀/大小与 CORS
fail-closed 没有核验记录」。header 投影、伪造 header、logout 已由
`model-gateway/fork/verify/oidc-header-projection.md` 与 `identity-chain.md` 覆盖，本文不重复。

实测日期 2026-09-29（UTC 09:46–10:02），本地拓扑 `deploy/local`（compose 项目 `kailo-local`）。
网关镜像 `model-gateway@sha256:174afd82…`，配置文件由宿主 `deploy/local/model-gateway-config.yaml`
挂载，改动即时生效。核验期间没有改代码、配置、compose，也没有重启服务。

## 0. 核验时拓扑的状态（影响下文第 3 节，须先读）

| 项 | 观测 |
|---|---|
| 网关投影的 header | 挂载的配置文件（工作树未提交的 ADR-17 改动）`set` 的是 `x-platform-oidc-issuer/subject`，并把 `x-kailo-oidc-*` 放进 `remove` |
| 运行中 BFF 认的 header | `grep -a -o 'x-(platform\|kailo)-oidc-…' /proc/<core-bff pid>/exe` 只命中 `x-kailo-oidc-issuer/subject`（容器建于 08:38，早于 header 改名） |
| 结果 | 真实登录后，带会话经网关访问 `/api/v1/session` 得到 `403 {"class":"DENIED","reason":"IDENTITY_HEADER_MISSING"}` |

这属于 fail closed，不是放行；但它意味着此刻本地浏览器链路上**任何已登录请求都会被拒**，
直到 core-bff 按新 header 名重建，或配置回退到旧名。因为网关配置是运行期挂载的，
工作树里的改动会立刻作用到运行中的网关。第 3 节的「本源正常」因此只能直连 BFF 取证。

## 1. 真实登录

方法与 `web-walkthrough.sh` 一致：走完 IdP 授权码流程，在 IdP 登录表单提交口令。
口令从 `deploy/local/secrets/bootstrap_user_password` 读入进程内存，不上命令行，也不写入日志。
用户 `kailo-bootstrap-admin`（Tenant `kailo-verify` 的成员）。所有请求都带
`--resolve gateway.kailo.local:58090:127.0.0.1 --resolve keycloak.kailo.local:8080:127.0.0.1`。

```text
GET  http://gateway.kailo.local:58090/app/               -> 302 .../realms/kailo/protocol/openid-connect/auth
                                                             (response_type=code, scope=openid profile email,
                                                              code_challenge_method=S256)
POST <IdP 登录表单 action>                                -> 302 http://gateway.kailo.local:58090/oauth/callback?...
GET  /oauth/callback?...（带事务 cookie）                  -> 302 /app/
```

## 2. 会话 cookie

设计依据：`.design/09` §5、`SF-AGW-10`、`SF-AGW-18`、`SF-AGW-22`；上游符号
`agentgateway/crates/agentgateway/src/http/oidc/session.rs::RESERVED_COOKIE_PREFIX/MAX_BROWSER_COOKIE_VALUE_SIZE/cookie_header/derive_cookie_names`，
`local.rs` 固定 `SameSiteMode::Lax`、`CookieSecureMode::Auto`（固定 commit `1f7ebbf8…` 与二开树 `apps/model-gateway` 逐行一致）。

回调响应头（cookie 值已隐去）：

```text
set-cookie: agw_oidc_s_ee32d8ac206f2fbc=<redacted>; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600
set-cookie: agw_oidc_t_ee32d8ac206f2fbc.<事务id>=<redacted>; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
```

登录起点的事务 cookie：`agw_oidc_t_ee32d8ac206f2fbc.<事务id>=<密文>; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`。

| 设计要求 | 实测 | 结论 |
|---|---|---|
| cookie 名以保留前缀 `agw_oidc_` 开始 | 会话 `agw_oidc_s_<8 字节 hex>`，事务 `agw_oidc_t_<8 字节 hex>.<id>` | 符合 |
| 全入口只有一份会话（listener 级 policy，`SF-AGW-22`） | 登录在 `/app/` 发起，回调在 `/oauth/callback` 完成，两者 cookie 后缀同为 `ee32d8ac206f2fbc` | 符合 |
| HttpOnly | 两类 cookie 都带 `HttpOnly` | 符合 |
| SameSite=Lax | 两类 cookie 都是 `SameSite=Lax` | 符合 |
| Path | `Path=/` | 符合 |
| Secure 按 redirect URI 是否 https 决定（`Secure=Auto`） | 本地 redirect URI 为 `http://`，cookie 无 `Secure` | 符合设计；生产须用 https 的 redirect URI，否则 cookie 不带 `Secure`——这一点只能在生产拓扑上复核 |
| 编码值 ≤ 3800 字节（IdP 的 ID-token claim 预算） | 从 cookie jar 取会话值长度：**1764 字节**（scope `openid profile email`，该用户） | 符合，余量约 2036 字节 |
| 默认 TTL 3600 秒，受 ID-token 过期约束 | cookie `Max-Age=3600`；realm `accessTokenLifespan=900`（admin API 只读取得）。以回调响应的 `date` 为起点，第 880 秒带原 cookie 访问 `/api/v1/session` 仍通过网关（到达 BFF，得到第 0 节的 `403`），第 906 秒同一 cookie 得到 `302` 到 IdP 授权端点 | 符合：浏览器保留 cookie 一小时，但网关按 cookie 内 `min(TTL, exp)` 在 900 秒处拒收 |
| 伪造或损坏的会话 cookie 不被接受 | 伪造 5000 字节 `agw_oidc_s_ee32d8ac206f2fbc` 访问 `/app/` → `302` 到 IdP；伪造短值访问 `/api/v1/session` → `302` | 符合 |

**超过 3800 字节时的行为：运行期无法核验。** 要让编码后超过上界，需要让 IdP 签出更大的 ID token
（加 claim mapper 或改用户属性），这属于改 IdP 配置或数据，超出本次授权。源码核对
（`session.rs::encode_browser_session` → `Error::SessionCookieTooLarge`；`proxy/mod.rs` 把它映射为
`500 INTERNAL_SERVER_ERROR`；`callback.rs::handle_callback` 在 `?` 处返回，不写会话 cookie）说明：
超限时回调以 500 失败、不下发会话，属于 fail closed。两点限制如实记录：
一是二开树 `oidc/tests.rs` 中没有覆盖 `SessionCookieTooLarge` 的用例；二是 500 不带
`apps/06` §4 的分类，界面无法把它识别为 `LIMIT`（claim 预算超限）。

**代理剥离 `agw_oidc_` cookie、不转发给 BFF：本次无法在运行期观测。** BFF 不记录 cookie，本地拓扑也
没有回显后端；该项仍只有源码证据（`apply_request_policies` 中 OIDC 之后的剥离步骤）与
`oidc-header-projection.md` 当时的回显后端观测（只观测了 header）。

## 3. CORS

设计依据：`.design/09` §5「CORS preflight 在 OIDC 前执行且被 OIDC 跳过。BFF 对任何缺少已验证 issuer
或 subject header 的请求固定拒绝且不执行 Admission，包括 OPTIONS；Gateway CORS policy 不构成平台认证」
（`SF-AGW-18`；`http/oidc/mod.rs::is_cors_preflight`）；`apps/AGENTS.md` 第 16 条。

配置事实：浏览器 listener 与原生 listener 都**没有** `cors` policy；BFF（`platform-core/src/bff.rs::router`）
没有 CORS layer，也不读 `Origin`。因此任何响应都不会出现 `Access-Control-Allow-*`。

### 3.1 经网关（`E=https://evil.example`，`O=http://gateway.kailo.local:58090`）

| 请求 | 结果 |
|---|---|
| `OPTIONS /api/v1/actions`，`Origin: E`，`ACRM: POST`，`ACRH: content-type`，**不带 cookie** | `405`，`allow: POST`，无 `access-control-*`。未被 OIDC 重定向，说明预检跳过了 OIDC 并到达 BFF |
| 同上，带会话 cookie | `405`，无 `access-control-*` |
| 同上，`Origin: O` | `405`，无 `access-control-*` |
| `OPTIONS /api/v1/session`，`Origin: E`，`ACRM: GET` | `405`，`allow: GET,HEAD`，无 `access-control-*` |
| `GET /api/v1/session`，`Origin: E`，带会话 cookie | `403 IDENTITY_HEADER_MISSING`（第 0 节的 header 名错位），无 `access-control-*` |
| `GET /api/v1/session`，`Origin: O`，带会话 cookie | 同上 `403`。这就是第 0 节所说的状态，不是 CORS 行为 |
| `POST /logout`（网关原生 logout），`Origin: E`，带会话 cookie | `403 CSRF validation failed` |
| `GET /api/v1/platform-info`，`Origin: E` / `O` | `404`：运行中的 BFF 没有该路由（构建早于 `DD-111` 入口） |

### 3.2 直连 BFF `127.0.0.1:58081`，带运行中 BFF 认的已验证身份 header（与集成测试同一入口）

| 请求 | 结果 |
|---|---|
| `GET /api/v1/session`，`Origin: O` | `200`，返回会话，无 `access-control-*` |
| `GET /api/v1/session`，`Origin: E` | `200`，返回同一会话，无 `access-control-*` |
| `OPTIONS /api/v1/session`，`Origin: E`，`ACRM: GET`，带或不带身份 header | `405`，无 `access-control-*` |
| `POST /api/v1/actions`，`Origin: E`，`content-type: text/plain`，JSON 正文 | `422 {"class":"PRECONDITION","reason":"INVALID_PARAMETERS"}`：axum `Json` 提取器拒绝非 `application/json`，动作不执行 |

### 3.3 结论

| 设计要求 | 结论 |
|---|---|
| 非本源预检被拒 | **符合**：任何 Origin 的预检都是 `405` 且没有 `Access-Control-Allow-Origin`，浏览器不会发出随后的跨源请求。预检跳过 OIDC 后由 BFF 拒绝；拒绝码是 405 而不是 `IDENTITY_HEADER_MISSING`：OPTIONS 在路由层先被方法匹配拒绝，身份解析没有执行，也就不执行 Admission |
| 非本源带凭据请求被拒 | **部分符合**。浏览器读取层面符合：响应不带 `Access-Control-Allow-Origin`/`-Credentials`，脚本读不到正文。服务端层面**不拒绝**：BFF 不看 `Origin`，跨源的带凭据 `GET` 照常执行，并产生副作用（`/api/v1/session` 会 `ensure` 一条 PlatformSession）。需要 JSON 的写入口因 `Content-Type` 检查而要求预检，所以被挡住；但不读 JSON 正文的 `POST` 入口不需要预检——`POST /api/v1/workspaces/{id}/media`（`Bytes`，任意 content-type）、`POST /api/v1/approvals/{id}/withdraw`（无正文）、`POST /api/v1/logout`（无正文）。对它们，唯一的屏障是网关 cookie 的 `SameSite=Lax`：跨站（cross-site）POST 不带 cookie；**同站跨源**（同一可注册域下的其它子域）的页面发起的 POST 会带 cookie 并被执行。见「发现」 |
| 本源正常 | **本次无法端到端核验**：经网关的本源请求被第 0 节的 header 名错位挡成 `403`。直连 BFF 时本源请求 `200`；同源请求本来就不走 CORS，BFF 没有 CORS 配置不会影响本源 |
| Gateway CORS 不构成认证 | 符合：两个 listener 都没有配置 CORS；认证只由 OIDC/jwtAuth 与 BFF 的 header 检查承担 |

## 发现（未修，交协调者）

1. **运行拓扑 header 名错位（环境，高影响）。** 复现：按第 1 节登录后
   `curl -b <jar> http://gateway.kailo.local:58090/api/v1/session` → `403 IDENTITY_HEADER_MISSING`。
   原因：挂载的网关配置已是工作树中未提交的 `x-platform-*`，运行中的 core-bff 仍认 `x-kailo-*`。
   影响：本地 Web 与原生入口的全部已登录请求被拒（fail closed），依赖网关的走查此刻都会失败。
   配置改动即时生效，所以工作树里改网关配置等于直接改运行中的网关。
2. **不读 JSON 的 `POST` 入口可被同站跨源页面以简单请求触发（设计缺口 / 待决）。** 复现（直连 BFF，模拟
   网关投影后的请求，主体为遗留夹具 subject `verify-f311f55a`）：`POST /api/v1/logout`，带
   `Origin: https://other.kailo.local`，不带 `Content-Type` 和正文 → `200 {"revoked":true}`，无
   `access-control-*`；该主体的 PlatformSession 由 `cb9a97b3…` 变为下一次请求新建的 `5b8e3365…`。
   BFF 不检查 Origin；`withdraw` 与 `media` 的提取器形状相同（源码核对，未实测，以免产生副作用）。
   浏览器侧只要 cookie 被发出（同站），请求就会执行。
   影响：撤回审批、注销、上传媒体可被同一注册域下的其它站点诱发。`.design` 没有要求 Origin 或 CSRF
   校验，所以记为设计缺口，不判为实现违约。
   可选处置（留给设计决定）：在浏览器 listener 上启用网关的 `csrf` policy，或让 BFF 对非 GET 请求要求同源
   `Origin`/`Sec-Fetch-Site`。
3. **cookie 超限不带分类、没有单测（低）。** 见第 2 节。
