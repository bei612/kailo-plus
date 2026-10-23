# Wren page presented as Kailo 问数 (DD-133)

## Authority

Design: DD-133 and `.design/07` §4.7 at design-authority
`1a8c395e1c67bc3a24119123fd7046731e11c2c8` (§4.7.1 build inputs, §4.7.2 wire
v1, §4.7.3 claims, §4.7.4 organisation mapping, §4.7.5 back-channel logout);
DD-127(7)/(9), SS-WRN-IDENTITY. Platform delivery used unchanged:
`client-kit/embed/` from `feat/platform-embed` `03993cc5`.

## What changed

| Area | Change |
|---|---|
| White label | `<title>` = `PLATFORM_DISPLAY_NAME` + 问数 / Data Q&A; favicon and marks are `web-client/web/public/app-icon.png` (build input, served as `/kailo/app-icon.png`); upstream logos, favicon, version line, Discord/GitHub/docs/API-reference links, "Vote on GitHub", Learning section and driver.js guides (incl. the first-visit "Data modeling guide"), upstream sample datasets and their questions, "Wren AI"/"Wren SQL" copy removed. PostHog is a no-op on server and client; no telemetry setting reaches the browser. Removed upstream files are listed in `fork/upstream.yaml` `remove_paths`. |
| Presentation | `_document` renders `<meta name="kailo-web-origin">` from `KAILO_FRAME_ANCESTORS` per request, then the icon, `kailo-theme-tokens.css` and `kailo-embed.js` (all copied from `client-kit/embed` at image build). antd 4 runs its variable build; `styles/kailo/antd-theme.less` compiles neutrals, radius and font as `--kailo-*` references and `styles/kailo/overlay.less` maps `--ant-*`, Wren's `--gray-*`/`--geekblue-*` and dark-mode surfaces onto `--kailo-color-*`. Theme/locale come only from `KailoEmbed` (`onThemeChange`/`onLocaleChange`, `useIdentityLocale` at top level); antd `ConfigProvider` locale and Next locale follow it. Inside Kailo the header drops the product mark and account menu and keeps the business navigation. Inter is `@fontsource-variable/inter` 5.3.0, the web-client version. |
| Sign-in | Gateway OIDC moved to the UI route; `login.redirect` = `/kailo-embed/signin`, a static Gateway page (CSP-hash pinned) that tries the IdP session in a hidden same-origin frame and, when the IdP needs interaction, posts wire v1 `auth-required` to the exact Kailo origin without rendering any login UI. Apollo renews a 401 silently once, otherwise calls `KailoEmbed.requestTopLevelSignIn()` (embedded) or `/auth/login` (top level). |
| Sign-out | `POST /auth/logout` → `/kailo-embed/signed-out` → `KAILO_LOGOUT_URL` at top level. IdP logout ends Gateway sessions through OIDC Back-Channel Logout at `/oauth/backchannel-logout` (model-gateway, see `model-gateway/fork/verify/backchannel-logout.md`). |
| Users | Middleware forwards the verified token's display claims (`name`, `preferred_username`, verified `email`, `picture`, `locale`) as `x-kailo-native-user` with key `sha256(JSON[iss, sub])`; browser-supplied copies are always stripped. `kailo_user` holds the latest claims; `owner_key` on `thread`, `sql_pair`, `instruction`, `api_history` (migration `20261021000000`, reversible). Threads, knowledge tables and API history show the Kailo name and avatar. |
| Roles | Only from Core. GOVERNED: binding `manage` = admin, `discover` = member (existing wrappers). STANDALONE: every user is a member until the member directory is delivered; member writes to modeling, connection, project settings/reset, knowledge and dashboards are refused server-side (`KAILO_ADMIN_REQUIRED`, GraphQL and REST) and hidden in the UI; a member may rename/delete/correct only threads it started. |

## Organisation and role mapping (for `07` §4.7.4, Wren)

| Kailo 概念 | 组件原生对象 | 自动建立 | 成员加入/移出 | 角色派生 | 成员目录未交付时 |
|---|---|---|---|---|---|
| Tenant | 部署单元（`DEDICATED_INSTANCE`）内唯一的 Wren 项目（当前项目取首行，SS-WRN-IDENTITY）；用户资料表 `kailo_user`（键为 `iss`+`sub` 摘要）；对话、问题与 SQL、指令、API 记录以 `owner_key` 记归属 | 实例部署时存在；用户首次以 Wren 专属 browser client 登录即即时开户（写入 `kailo_user`，每次登录刷新显示名、头像、已验证邮箱、语言），无本地账号与密码 | 加入：持有实例声明（`native_instances`）的 Kailo 用户首次访问；GOVERNED 每个请求经 Core binding `discover` 现场判定，撤员即时失效；STANDALONE 由成员目录增删，撤员在下一次目录读取后生效 | Tenant `ADMIN`（SpiceDB Tenant `manage`；GOVERNED 为 binding `manage`）→ Wren 管理员：建模、部署、数据源连接与重连、项目设置与重置、知识（指令、问题与 SQL）与看板写入；其余 → 成员：问数、查看知识与看板、重命名/删除/修正自己发起的对话 | 全部即时开户为成员（只能问数与管理自己的对话）；不在组件内授予管理员，不从 IdP groups、email 或显示名推导；STANDALONE 期间建模与连接无人可改，需要时以 GOVERNED binding（Core `manage`）进行 |
| Workspace | 无独立原生对象：单项目实例，GOVERNED binding 所属 Workspace 即该项目的可见范围 | binding 建立时（DD-127(3)，Tenant 管理员以 `application_binding.create`） | GOVERNED 由 Core `discover` 按 Workspace 成员关系现场判定；STANDALONE 不区分 Workspace，按目录 Tenant 成员 | 不派生额外角色（同 Tenant 行） | 同 Tenant 行 |

人员显示：组件内对话、知识与 API 记录的归属以 Kailo 名称与 `picture` 显示；Wren 没有人员选择器、@ 或分享对象列表。

## Evidence

See the commit messages of `feat/wren-embed` for the exact commits; results
recorded there and in the delivery report:

- `wren-ui` jest (CI container, network off): new suites
  `src/kailoUserMiddleware.test.ts` and `src/kailoIntegration.test.ts` pass;
  the remaining failures are the same set as on `main` `9f66b735` with the same
  runner (pre-existing).
- `tsc --noEmit`: only the pre-existing `src/nativeQueryDelivery.test.ts(38,9)`
  error, unchanged from `main`. `next lint`: exit 0.
- `node --test data-query/docker/kailo-embed/page.test.mjs`: 8/8, against the
  body and CSP actually rendered into `native-gateway.yaml`;
  `python3 -I data-query/docker/kailo-embed/render.py --check` passes.
- Gateway configuration: `--validate-only` with the deployed Gateway image and a
  live smoke run (unauthenticated navigation → `/kailo-embed/signin`, fetch →
  401 with `Location`, explicit login → IdP with `openid profile email` and PKCE,
  `POST /auth/logout` → 303 `/kailo-embed/signed-out`, cross-origin logout → 403,
  page CSP pinned to the script hash).

## Boundaries

- `fork/release/manifest.native-page.json` declares `KAILO_EMBED` (`LIVE`,
  `BROWSER_RESOLVED`, `LIGHT→light`, `DARK→dark`, `ZH_CN→zh-CN`, `EN→en`), the
  shape Core admits since the DD-133 platform merge; the governed adapter
  release (`manifest.json`, not a `NATIVE_PAGE`) keeps `NONE`.
- The IdP side is deployment work: the Wren browser client needs the
  `kailo-picture`/`kailo-locale` mappers (§4.7.3) and
  `backchannel.logout.url=<Wren origin>/oauth/backchannel-logout`,
  `backchannel.logout.session.required=true`,
  `backchannel.logout.revoke.offline.tokens=false`, `frontchannelLogout=false`.
- Only the shell (navigation, sidebar, settings, home landing, knowledge
  ownership, session states) is translated; most original page copy is still
  English.
- Nothing was deployed.

## Production acceptance (2026-10-23, DD-133 问数部分)

Deployed: Gateway at main `a06b5913` (login fix), Wren binding `2709f33a`
(release `5a942f6e`, `wren@1.2.0-native-page`, `KAILO_EMBED`). Scripts and raw
output on the CI node under `~/kailo-acceptance/dd133/`: `scripts/acc2.mjs`,
`logout2.mjs`, `reauth.mjs`; output `out-20261023-r2/kailo-qa-{1,2,3}/`
(`acc.jsonl`, `logout.jsonl`, screenshots) and `out-20261023-r2/reauth/`.
qa-1/2/3 each ran once; values below hold for all three.

| Scenario | Result | Evidence |
|---|---|---|
| V-SCN-198 white label | PASS | sidebar entry and top-level tab: title `Kailo 问数`, favicon/tokens/`kailo-embed.js` sha256 equal to the repository bytes at `a06b5913`, no upstream brand hits, `data-kailo-embedded` only when framed |
| V-SCN-199 silent SSO / sign in again | PASS | first open lands on `/home` signed in, no password field or login UI; after the IdP session and the Gateway cookie were cleared with Kailo still signed in, the frame stayed on `/kailo-embed/signin`, the host showed “登录已失效…重新登录”, the click went to the IdP at top level and returned to `/app/applications/2709f33a…` with Wren signed in (`reauth/kailo-qa-*-wren.jsonl`) |
| V-SCN-201 theme | PASS | `?kailo_theme=dark` → `data-kailo-theme=dark`, background `rgb(26,26,26)`; live switch kept the frame (`marker=kept`) and turned light |
| V-SCN-201 locale | FAIL | `?kailo_locale=en`: runtime state `en`, but Next stayed `zh-CN` and `<html lang>` was reset to `zh-CN`. Cause: the one-shot locale replace at mount was aborted by the onboarding redirect `/`→`/home` (“Abort fetching component for route: /”). Fix: branch `fix/wren-embed-locale` `10e9dd66` (locale re-checked after every navigation; jest `kailoIntegration.test.ts` 15/15, tsc only the known `nativeQueryDelivery.test.ts(38,9)`), not deployed |
| V-SCN-201 forged messages | PASS (runtime) | same `kailo-embed.js` bytes as the knowledge page, where self-posted and other-origin messages were ignored |
| V-SCN-204 back-channel logout | PASS | Gateway session from the same browser context: `/home` 200 before, 302 → `/kailo-embed/signin` after Kailo sign-out (GraphQL 403 → 302); open Wren tab followed Kailo to the IdP |

The display name inside Wren comes from the IdP `name` claim (`1 QA`), not the
Kailo display name (`kailo-qa-1`); the avatar URL answers 404 for every
same-Tenant requester, so the picture is broken (V-SCN-200, Core, see the Cells
record).

## Member directory sync (DD-133(4), 2026-10-23, source stage)

Authority: design-authority `.design/07` §4.7.4 (read contract and the Wren
mapping table) and `.design/02` DD-133(4); Core read
`core/crates/platform-core/src/component_directory.rs`, contract
`contracts/api/component_member_directory.schema.json`.

- **Read** (`wren-ui/src/apollo/server/services/kailoMemberDirectory.ts`):
  `KAILO_DIRECTORY_*` (from `WREN_DIRECTORY_*` through
  `docker/member-directory.yaml`); none = off, a partial or invalid set refuses
  start. At start and every interval (default 60 s, 10..3600): client
  credentials with HTTP Basic from the secret file (≤4 KiB, re-read every
  time), then `GET /service/v1/component-directory/bindings/<binding>/members`;
  no redirects, 10 s / 30 s timeouts, ≤16 MiB body, closed-object contract
  check, `bindingId` must be the configured binding, `directoryVersion` a
  lowercase SHA-256. Only identities whose issuer is this instance's verified
  issuer (`WREN_NATIVE_IDENTITY_JSON.issuer`) count. Reads never overlap.
- **Apply**: unchanged `directoryVersion` writes nothing. A new one replaces
  `kailo_directory_member` (issuer+subject digest = `kailo_user` key, principal,
  admin) and upserts `kailo_user` name/picture with the Kailo display name and
  avatar in one transaction, then records the version in
  `kailo_directory_state` (migration `20261023000000_kailo_member_directory`,
  reversible). `kailo_user` rows are never deleted. 503, 401/403/404, token
  refusal, transport error, unreadable secret, malformed or foreign snapshot:
  no change, the applied snapshot keeps deciding, retried next interval; logs
  carry the outcome and HTTP status only.
- **Admission**: the Edge middleware asks this same instance's Node consumer
  `GET /api/kailo/directory-access` (the hop passes the middleware itself, so
  the user is the one verified from the token; the answer is only that user's
  own entry, checked against the user key) for every human page, GraphQL and
  REST request. After the first applied snapshot a person absent from it gets
  `403 {"error":"KAILO_NOT_MEMBER"}` in both modes; STANDALONE `admin` is the
  directory `tenantRole=ADMIN`, so the existing `KAILO_ADMIN_REQUIRED` checks
  follow it; GOVERNED keeps `admin=null` and Core `manage`/`discover`. Lookup
  failure or a mismatched answer is 503. Before the first snapshot: every
  signed-in user is a member, nobody an admin (unchanged). The persisted
  snapshot is loaded before any decision, so a restart never reopens or
  demotes. After login, a delivered member's `kailo_user` name/picture stay the
  directory values; login name, verified e-mail and locale still come from the
  token.
- **Mapping**: as the Wren table in `07` §4.7.4; `workspaces[]` create
  nothing and raise no role.
- **Deployment**: `deploy/components/data-query.env.template` `WREN_DIRECTORY_*`;
  `docker/README.md` "Member directory (DD-133(4))". wren-ui joins
  `WREN_QUERY_PLATFORM_NETWORK` (Core service listener) only with the overlay;
  the secret is the platform runtime file written by the release IdP
  declaration, mounted as a Compose secret.

Tests (`wren-ui/src/kailoMemberDirectory.test.ts`, real better-sqlite3 knex with
the real migrations, local HTTP fake IdP/Core, real middleware with a local
JWKS and a stand-in Node consumer): configuration all-or-none and limits;
closed contract and binding match; pre-delivery behaviour; first snapshot
(Basic credential, bearer, roles, foreign issuer ignored, profile refresh
keeping login name/e-mail); unchanged version writes nothing; 503, 401, token
401, bad JSON, foreign binding and missing secret change nothing; removal,
demotion, promotion with `kailo_user` kept; restart keeps the persisted
snapshot; login naming before/after delivery; migration down/up; middleware
refuses non-members on page/GraphQL/REST, sets the STANDALONE role, fails
closed on lookup error or a foreign answer, skips the lookup path and the
unconfigured case.

Results (CI node, `node:18-bookworm-slim`, `--network none`, 4 CPU / 6 GiB,
UID 1000, wren-ui locked dependencies installed with the repository's yarn
4.5.3 `install --immutable`; tree from `git archive` of the pushed commit
`5c8821975e787f2e5266b26ee9040b94e7cf463f`):

- `jest --runInBand src/kailoMemberDirectory.test.ts src/kailoDirectoryAccess.test.ts
  src/kailoIntegration.test.ts src/kailoUserMiddleware.test.ts`: 4 suites pass
  (the two new suites 17 tests).
- `src/middleware.test.ts`: 85 failed / 75 passed, identical to `main`
  `0e9c076c8` with the same runner (pre-existing, not touched here).
- Whole `jest --runInBand`: the same 11 failing suites as `main` `0e9c076c8`
  (pre-existing; the run does not exit by itself on either commit and was
  stopped after the last suite reported).
- `tsc --noEmit`: only the pre-existing `src/nativeQueryDelivery.test.ts(38,9)`
  error, same as `main`. `prettier --check` and `eslint` on every changed
  source: exit 0.

Not done here: image build, deployment, the platform IdP client and binding
registration, and acceptance with real Tenant members.


## 通知、分享与搜索来源（DD-138(4)/(5)，2026-10-23，源码阶段）

依据 `.design/07` §4.8.3（组件通知并入 Kailo 收件箱）与 §4.8.4/§5.2（组件内容作为
搜索来源）。本节只记录源码与单元测试；未构建、未部署、未做运行验收。

改动：

- **收件人身份**：迁移 `migrations/20261024000000_kailo_user_identity.js`（可逆）为
  `kailo_user` 加 `issuer`、`subject`。来源只有两处已验证事实：中间件转发的已验签令牌
  （`utils/kailoUser.ts` 把 `iss`/`sub` 放进私有转发头；`KailoUserDirectory.remember`
  先用二者重算 `user_key`，一致才写入，缺失时不清除已存值）与已应用的成员目录快照
  `members[].identities[]`（`kailoMemberDirectory.ts` `apply()`）。
- **通知投递**：`services/kailoNotifications.ts`。复用目录 client 的
  client-credentials（`kailoMemberDirectory.ts` 导出 `kailoServiceToken`，增加
  `expires_in`），令牌缓存到过期前 30 s，缓存令牌遇 401/403 换新一次。目录配置
  不完整即不启用（no-op）。有界内存队列（默认 500，满则丢最旧并计数日志），单个后台
  worker；201/200 成功，400/401/403/409 终止，429/5xx/网络错误以同一幂等键退避重试
  （共 5 次，约 5 分钟）。幂等键 `data-query.<category>.<sha256 前 40 位>`，按
  （事件, 接收人）确定。日志只含 binding、类别、HTTP 状态。路径用共享
  `componentPath` 校验。不发送通知者本人，不发给不在当前目录或身份未知的人。
- **分享给成员**：GraphQL `kailoShareMembers`、`shareWithMembers(data:{target:{threadId|dashboard},
  recipients,requestId})`、`KailoSession.shareAvailable`（`schema.ts`、`resolvers.ts`、
  `resolvers/kailoShareResolver.ts`、`services/kailoShare.ts`、错误码
  `KAILO_SHARE_UNAVAILABLE`/`KAILO_SHARE_INVALID`）。校验：投递已启用且目录已交付、
  恰好一个目标且存在于当前项目、接收人 1–50 个、互不重复、不含本人、均为当前目录成员；
  任一不符整体拒绝且不发送。不改访问控制：单项目实例的全部成员本来就能读全部对话与
  唯一看板（§4.7.4 问数映射表）。前端 `components/kailo/KailoShare.tsx`（antd Modal
  + Select，套 Kailo 主题，无自定颜色），放在对话页右上与看板头部；文案在
  `utils/kailoI18n.ts`（中/英）。`requestId` 每次打开弹窗一个，重复提交不重复通知。
- **看板通知**：(a) `dashboardResolver.createDashboardItem` 成功后后台通知对话创建者
  （非操作者本人），类别 `CONTENT_UPDATED`（“你的问题已加入团队看板”）；(b)
  `DashboardCacheBackgroundTracker` 定时刷新一轮结束后上报 `{dashboardId, runId, total,
  failed}`，有失败项时给目录中每位 Tenant 管理员各发一条 `TASK_COMPLETED`（同一轮同一
  幂等键）。路径均为 `/home/dashboard`；分享对话为 `/home/<threadId>`。类别依 §4.8.3：
  分享=SHARED，自己的对象被他人改动=CONTENT_UPDATED，后台任务结束=TASK_COMPLETED。
- **搜索来源**：`platform-adapter/[operation].ts` 新增 `search`（`next.config.js` 改写
  `/platform-adapter/v1/search`，`middleware.ts` 机器路由放行，Origin/Cookie 仍 403）。
  直接复用本路由已引用的 `client-kit/adapter/protocol.mjs` 的 `searchArguments`、
  `verifySearchToken`、`searchResponse`（与 Node adapter 同一份代码，而非 TS 重写；
  配置取 `WREN_PLATFORM_QUERY_CONFIG_FILE` 的 ActionToken issuer/audience/JWKS 与
  tenant/workspace/binding）。`services/kailoAdapterSearch.ts`：`resources[]` 中只有
  `nativeType` 为 `model`/`view` 且 `nativeId` 为所交付项目内模型/视图 id 的条目属于本
  binding；至少一条属于时，以该项目为 native scope 检索对话（摘要或首个问题）与看板项
  （显示名），`LIKE` 小写匹配并转义 `% _ \`；否则返回空。结果种类 QUESTION/DASHBOARD，
  路径为原生页面路由。`fork/release/manifest.json` 的 `executionConnector` 加
  `"searchSource": "SUPPORTED"`（其余字节不变；native-page manifest 未动）。

测试（jest，未在本机运行）：

- `src/kailoNotifications.test.ts`：无配置 no-op；201 投递、请求体形状、令牌缓存；
  200/409/403 不重试；429/503/网络错误同键重试；5 次后放弃；缓存令牌 401/403 换新一次；
  临期令牌不复用；队列满丢最旧；路径/自通知/超长标题/幂等键/类别校验；分享事件只发给
  当前成员且不含本人、重放同键；看板加入通知；刷新失败按管理员聚合；定时刷新上报。
  分享校验：候选人、合法对话/看板分享、不可用三种情形、十种非法输入整体拒绝。
- `src/kailoAdapterSearch.test.ts`（真实路由 + 真实 ES256 Search Token + sqlite）：合法
  请求返回本项目对话与看板项；通配符按字面；不属于本 binding 的 resources 被忽略；
  binding/tenant/workspace/摘要/token_use/target/有效期/audience/zed token 不符 401；
  缺 bearer 401、非规范体与幂等键不符 400；Cookie/Origin 403；结果清洗。
- `src/kailoMemberDirectory.test.ts`：快照写入 issuer/subject；登录只在哈希一致时存储、
  不被缺省清除；身份迁移 down/up。`src/kailoUserMiddleware.test.ts` 转发头含 issuer/subject。

未验证：全部测试尚未在 CI 执行，`tsc`/`eslint`/`prettier` 未跑；`__types__.ts`、
`kailo.generated.ts` 为手工补写，需 codegen 核对；Core 端通知入口与搜索调用的联调、
真实收件箱呈现、镜像构建与部署、真实成员的端到端验收均未做。
