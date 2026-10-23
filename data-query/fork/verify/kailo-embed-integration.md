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

Not done here: image build, deployment, the platform IdP client and binding
registration, and acceptance with real Tenant members.

