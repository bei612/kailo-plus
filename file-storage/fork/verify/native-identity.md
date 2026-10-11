# Cells 原生身份接线

本目录保留固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的完整 8935 个原生文件、UI、数据库和会话入口，并继承 RTq1FU 的 9 个 adapter/deploy 文件（含 `deploy/.env.example`）。不是仅摘取 OAuth 或 MCP 的影子服务。原生身份源码、实际 HTTP 消费者后置目标和生产守卫破坏/恢复已通过；没有集成镜像、部署或真实 OIDC 验收。

## 四步影响

1. 查证：`.design/01` REQ-01/03、`07` 独立服务/公共身份边界、`18` 原生管理后台保留。固定原生 `common/auth/connector-pydio.go::DefaultConnectorScanner` 只加载本地密码 connector；`common/auth/connectors.go::CallbackConnector` 没有实际 HTTP 消费者。原 `frontend/web/service/service.go` 是原生 UI 宿主，`ReactUI/router/LoginCallbackRouter.js`、`AuthorizationCodeAuth`、`LoginSuccessWrapper` 已消费原生一次性 code。
2. 影响：在原生 frontend/web 挂载 `/auth/kailo/login` 与 `/auth/kailo/callback`，复用已锁定的 `coreos/go-oidc/v3`、oauth2、gorilla sessions 和原 Hydra/UserService。没有依赖升级、Core API、业务正文复制、权限表或平台用户第二权威。完整 native UI 不替换。`deploy` 不再默认启动未二开的官方 5.0.2 镜像，必须投递实际已登记的 fork digest。
3. 实现：原服务的 `services/pydio.web.oauth/connectors` 唯一配置中增加显式 `kailo-oidc` 条目；固定 issuer/sub 只能关联已经存在的原生 User UUID。使用签名并加密的短期浏览器 transaction、state、nonce、PKCE；实际验证 ID token signature/issuer/audience/expiry。直接原生 UUID 查证、`auth.VerifyContext` 和原 `PolicyEngine.IsAllowed` fresh 核验后进入原 `CreateLogin/GetLogin/LoginChallengeCode`，仅将原生一次性 code 发给既有 `/auth/callback`。缓存 allow、fresh 拒绝或服务不明均不能签发；不把外部 access/refresh token 发往 UI/Core，不读 email/groups 做自动绑定，不创建用户、角色、管理员或 Workspace。
4. 验证与异常：后置测试直接调用 `NativeKailoOIDC` HTTP 消费者；隔离 OIDC/JWKS 与 Cells 自带 config/gRPC mock 为 fixture，不等同真实服务联调。覆盖原生成功 callback、邮箱变化、同邮箱异 subject、nonce/state、原生锁定/删除、fresh policy 拒绝/不明、exchange 期间撤销 connector、一次性外部 code 重放、回调替换及凭据权限。删除 subject 与 fresh policy 两生产守卫确实导致两例失败，逐字恢复后全部目标通过；不明不签发 native code，不回退密码/管理员。

## 唯一原生配置与权限范围

使用现 `CELLS_OAUTH_CONNECTORS` 或原生受控配置面投递同一 connector 清单，不另加用户 registry：

```json
{
  "id": "platform-identity",
  "name": "Platform identity",
  "type": "kailo-oidc",
  "config": {
    "issuer": "https://idp.example.invalid/realms/development",
    "clientId": "cells-native-ui",
    "clientSecretFile": "/run/secrets/cells_oidc_client_secret",
    "redirectUri": "https://cells.example.invalid/auth/kailo/callback",
    "requestTimeout": "",
    "transactionMaxAgeSeconds": 0,
    "clientSecretMaxBytes": 0,
    "users": [{"subject": "existing-idp-subject", "userUuid": "existing-cells-user-uuid"}]
  }
}
```

上述只是结构示例，不是地址、账号、密码或运行阈值默认值。三个空/零字段为明确不可运行的占位：requestTimeout 必须投递正数 Go duration，transactionMaxAgeSeconds 必须为正整数秒，clientSecretMaxBytes 必须为正整数 bytes；只从同一个 native connector 配置消费，没有缺省回退。凭据必须是原生服务可读的绝对 regular 文件，group/other 无权限；缺失拒绝，不生成密钥。issuer 和 callback 接受该原 native 受控配置的 HTTP(S)，包括明确局域网 IP；callback 必须等于原配置 external origin，不接受 browser 自报地址。HTTP 不被伪称加密传输；真实部署仍需遵守其批准传输政策。配置/链接更改会使旧浏览器 transaction 失效。原生用户自己的 role/workspace/锁定/OIDC policy 继续决定原生权限；平台成员或 Owner 不自动变成 Cells admin。

原 native `CreateLogin` 的 RequestURL 没有 redirect_uri，本接线仅对原 `cells-frontend` client 使用原 configured `/auth/callback`，与原 `Exchange` 一致。带入 challenge 在签发前后均核同一原生 client/callback。保留 native `openid/profile/offline` scope，不改 native session/refresh 语义。

## 完成边界

- 首轮身份批没有改变原 Go 锁与完整 UI；仅执行原包窄编译/测试，没有产品镜像、集群或业务写操作。后续原生登录页接线见末节。
- 新 HTTP consumer 的源与 case 不等于运行配置已投递或三人真实身份可登录；尚无该 native OIDC client/受控 secret/native UUID 链接投递证据。
- 首轮只有同一原生 UI 宿主 `/auth/kailo/login`；末节将该入口接到原生登录对话框，不建立第二前端。源码接线不代表发布产物已更新。
- 未闭合 SS-CEL-WOPI 的每请求 fresh PEP/用户 PAT、平台撤权与原生 session 生命周期、Gateway 工具生产消费或平台 Temporal 工作流，不据这个局部身份批宣称所有权限/工作流接入。
- 原 query_revision adapter 的既有隔离 21 case 证据不冒充本 native 身份代码已通过，也不授权历史 ContentReference。

## 实测回执

2026-10-05，独立候选 `/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage`。复用已缓存 `golang@sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，实际 Go 1.26.8；原锁 toolchain 为 1.26.4，二者不是同一生产构建证明。容器 `kailo-cells-native-check-lftow7`，UID 1000、4 CPU/8 GiB/no extra swap，私有 Data module/build cache，不挂在线 DB、正式源码或用户凭据。预检 host available 31 GiB、swap 0，容器只有 idle sleep；所有依赖按原 `go.mod/go.sum` 下载，`-mod=readonly`，后续 `GOPROXY=off`。

原目标：`go test -mod=readonly ./frontend/web ./frontend/web/service -run 'TestKailoOIDC|TestFirstRunMigration' -count=1 -v`。容器内仅以 `CELLS_WORKING_DIR=/cache/build/native-test-state` 指向私有原生测试状态，未投递生产配置。

| 原件（候选父目录） | 实际结果 | SHA-256 |
|---|---|---|
| `native-go-offline-first.log` | exit 1；原锁 module cache 不完整，setup 失败，未运行断言 | `1aa9a2575aabc0dd6c69464f24fec594b366daaf8d514e137aed343159d9bcf8` |
| `native-go-locked-baseline.log` | exit 1；依赖/源编译完成后，UID 1000 无原生 working dir，初始化失败 | `be7aa907615a0ad2c64bc49f665b58c38fb8a33f15ecefec9b229181f7ac4cb5` |
| `native-go-corrected-baseline.log` | exit 0；6 个 OIDC 顶层目标、9 个 HTTP consumer 子例及原 service 16 个断言 | `4be0369161528da604d53408036c0de113114bf6500edd11ff8d0467f945248c` |
| `native-go-production-mutation.log` | exit 1；subject 精确匹配与 policy deny 两守卫变异使两拒绝例变成 303/nativeCodes=1 | `98dd6a2efd844df594aa8ef0889a8e91d3bb9c542d736f21c9f3db0e8fcef5c5` |
| `native-go-restored-final.log` | exit 0；apply_patch 还原且 saved source cmp 0 后，原完整窄目标全部通过 | `e00cab34e92c0519fab00b856b1e8cd44291649c34385cc2ff7fe5c996271c39` |

第一次修正 working dir 后的中间运行（session 20113）保留于原工具输出而无单独日志：原 service 16 断言及拒绝例通过，两个成功例返回 503。原因是测试包没有执行原生产 `idm/oauth/grpc/service::init` 的 GRPC provider 注册；fixture 现在通过 `sync.Once` 调用同一原注册 API，未添加生产 fallback。

首轮冻结生产 handler SHA-256 `f30247e399aa0c9d6f11a5e2fce4bed767911505d2ee4e069dc1ed330c0038e1`。该轮 `gofmt -l` 三源码无输出、exit 0；原 `go vet -mod=readonly ./frontend/web ./frontend/web/service` session 45281 exit 0，`native-go-vet-final.log` 为真实空输出，SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。原锁前后 SHA-256 保持 `go.mod=bc47f5323264aa39696a0c56b9d563c60a80dd08831ed6ca21f681a7e3a85d16`、`go.sum=48aaa2b6d05e149f516ab8b9a251215357fd7ec92d9f1bedbd476f66ec8c11e4`。没有 full、产品构建、真实 IdP/原生 RPC 联调或权限/管理员写入。

## 原构建配方收口（独立追加）

2026-10-05 原 `docker buildx imagetools inspect docker.io/library/golang:1.26.8-alpine` exit 0，官方 OCI index 为 `sha256:8ac98ca534ac3f51e1f420a1dd2c15e74c75cfa0f23f3ad27eb5d7236c349a0c`；linux/amd64 manifest `sha256:66f9a494af2b76ecb3eab75ff47166df61caec6d200c59d556b77327493d83a8`，版本注解 `1.26.8-alpine3.24`。同次 `alpine:3.20` inspect exit 0，index `sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc`；amd64 manifest `sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e`，版本 `3.20.10`。这是官方 registry 元数据读回，不是已拉取/构建/部署声明。

原 `tools/docker/images/cells/buildx-dockerfile` 所有外部 FROM 按上述 index 固定，binary 阶段固定继承原 compile 阶段；没有可切回 released binary 的 `BUILD_MODE` 配置，未被消费的 download/local 阶段已删除，上游原配方仅留于只读 `.references`。Go 1.26.8 高于原 `go.mod` 的 1.26.4 toolchain 要求，采用 `GOTOOLCHAIN=local`、`-mod=readonly`、原 CGO_ENABLED=0 与 ldflags，未修改原锁；runtime 保留原 Alpine 3.20、entrypoint 和完整 native 服务。manifest 只登记真实仍被消费的 VERSION/GIT_REV/BUILD_STAMP/DOCKER_ENTRYPOINT_SRC_DIR；原 `.env.example` 明确列必填 CELLS_IMAGE，无可运行默认。没有执行产品构建；该包装部分不改变原身份/权限流程。

接收后的配置阈值纠正：移除新硬编码 300 秒、16384 bytes 和两处 10 秒；既有 `idm/oauth/grpc/service/service.go` 的 `CELLS_OAUTH_CONNECTORS`→原 native config producer 无须新的环境权威，测试 `config.Set` producer 与上述同源结构示例一起增加三个必填字段。新的 deadline 同时覆盖 discovery/exchange/native auth，transaction age 同时用于 cookie codec 与回调时效核验，secret bound 用于读取真实受控文件。原 Go 锁没有改变。`.design/07` §4.6 和已有 Cells `CELLS_NO_TLS`/`CELLS_EXTERNAL` 入口未规定 localhost-only；此处按批准 HTTP(S) origin 严格匹配，不另立 loopback 特例。下面追加的实际窄目标验证不是产品或真实 LAN/IdP 验收。

该纠正首次原窄目标 session 63757 exit 1，`native-go-config-final.log` SHA-256 `4327a729cef81d43b94b25dfbe4e0268de103f02ef0886139d46178c1cd40e65`：6 个旧 OIDC 目标和 service 16 断言通过，新增配置用例只修改 fixture 对象而未写回 native config，故 cookie 仍取旧值。修正为实际 `config.Set` producer 后，同原目标 session 15859 exit 0，`native-go-config-corrected.log` SHA-256 `98e4f0238ce14aee45dda19a5d5779e0b132e47d97f3c39f029f23e020b60ec0`：7 个 OIDC 顶层目标/9 个 HTTP consumer 子例及原 service 16 断言全部通过。新增用例覆盖缺失/非正配置、不同值确切投递、cookie 实际读回配置值、configured secret bound 和局域网 HTTP(S) origin；不使用生产默认或真实外部凭据。

配置纠正后 handler SHA-256 `5f6162843f40ef26a85e622f3c7e357a4af69653f8131127ef76fd5b5acfa73b`，test SHA-256 `496962693bffb1c835b6420849fc8a4271b96b0a8a789c5072d30a81d9731c5b`。首轮 guard 变异与逐字恢复原件继续保留；后续纠正未改变该 subject/policy 拒绝条件。该最后目标未额外跑 full/vet/镜像，不把首轮 vet 结果冒称新整批验收。

## 原生登录页接线（2026-10-05，源码阶段）

1. 权威：`.design/07` §4.6 的独立原生后台、公共身份复用和不重写页面；固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的 `frontend/web/index-handler.go::IndexHandler.ServeHTTP` 与 `frontend/assets/core.authfront/res/js/index.js::LoginPasswordDialog` 已重新用 Git 核验。原生 handler 存在但登录页没有消费者，故不是新的身份能力或新需求。
2. 影响：原 index 向现有 `StartParameters` 写可选 `KAILO_OIDC_LOGIN`；原 `LoginPasswordDialog.render` 直接用原 FlatButton 消费 label/href。新增字段只含配置显示名与既有同源登录路径，旧 UI 忽略该字段；没有数据库、Core 合同、身份或权限迁移。Web/Desktop 承载的是同一个外部原生页，Mobile 没有新增入口。
3. 副作用：不序列化 connector、用户链接、client secret 路径或密钥；不接受外部 return URL。原 login_challenge 只作转义后的参数传给既有原生登录链，后者仍核原生 client/callback。分享页的 `PASSWORD_AUTH_ONLY` 不显示此按钮，原密码认证不被隐式替换；按钮不触发自动登录或重试。
4. 异常：缺配置、多个 connector、非法 callback、畸形或重复 challenge 不生成该选项；无 challenge 走已有原生 CreateLogin。直接调用认证路由仍按原 handler 拒绝无效配置、身份、policy 或交易。并发点击使用现有单浏览器交易替换语义，不增加持久状态、Quota、副作用账本或成功推断；错误分类继续沿原身份/准入与上游不明路径，本批不增加错误枚举。

独立候选为 `codex-component-runtime-integration-20261005.lciVUS/apps`，生产四路径相对接收索引为 4 文件 +62/-1（含后置 Go 检查）。原 Go 窄目标使用固定 Go SDK、4 CPU/8 GiB/同等 memory+swap、Data 缓存，不使用宿主工具链；运行原件为 `cells-login-ui-go.log`，记录时尚未终态。

原前端安装首先实际退出 1：`ERR_PNPM_BROKEN_LOCKFILE`，重复 `@babel/code-frame@7.29.0`、`@babel/helper-plugin-utils@7.28.6`，同时已有依赖仍引用丢失的 code-frame 7.28.6。重复内容在上述固定 upstream commit 亦存在；按 npm registry 对确切 7.28.6 返回的 integrity/dependencies 恢复其原版本条目，删除完全相同的 helper 条目，不删除锁文件或浮动升级。下一次 frozen 安装退出 1，发现三个 rjsf snapshot 仍引用不存在的 lodash 4.17.21；对齐该锁已经选定的 4.17.23，保留原 integrity。上游既有 lodash 升级为 `8fca06c2ce7639ce9a92e1423c46abeaeb0b15b5::frontend/assets/pnpm-lock.yaml`。两次失败原件分别保留为 `cells-login-ui-build.log`、`cells-login-ui-build-lock-corrected.log`。

修正后同一个原 pnpm 10.7.1 frozen 安装实际完成 756 个锁定包（10m 5.6s），随后原 `core.authfront build` 退出 1：`Cannot find package '@babel/plugin-syntax-dynamic-import'`；webpack 5.104.1 报一个错误。完整原件为 `cells-login-ui-build-lock-restored.log`，不把安装成功记为编译成功。

核对同一原 `frontend/assets/webpack-commons.js::configLoader` 后，`core.authfront/package.json` 同时缺少该配置直接消费的 dynamic-import plugin 和 TypeScript preset 声明；原锁已经分别有 7.8.3 和 7.28.5 的 integrity/snapshot。只将这两个确切版本加入原包 devDependencies 与锁的该 importer，不改共享 webpack 配方、不移除 preset、不浮动升级，其他 importer 不变。

同一个受限 Node SDK 的原 frozen install/build（session 4329）实际退出 0：四个新增所需锁定包安装完成，`webpack 5.104.1 compiled successfully in 58306 ms`。`cells-login-ui-build-deps-corrected.log` SHA-256 为 `757bcad5f333fca40c8560f129eeb58d17ffe66b683ab9435260a9a86d9106ab`。原输出 `frontend/assets/core.authfront/res/dist/AuthfrontCoreActions.min.js` SHA-256 为 `3606e882f96ad1f469951277755f6d488b0d998acab934c92e5167260bc6196f`；对应 `.gz` 为 `7127a8d25ae55c16b203e0ac51b5675938f3544a96e4cf2ea0c15b00215cd513`，解压后与 JS 逐字 cmp 0。生成 JS 实际包含 `PASSWORD_AUTH_ONLY` 限定和 `KAILO_OIDC_LOGIN` 消费，不是手工修改的发布包。上述证明原生前端已生成；Go 验证、产品镜像、部署及真实 SSO 仍未据此验收。

随后原 Go 目标 session 62410 实际退出 0：8 个 OIDC 顶层目标、9 个原生 HTTP consumer 子例和原 service 16 个断言通过；日志 `cells-login-ui-go.log` SHA-256 为 `698bdb77f6e9a70a696e73ac0dba494361c7572493f3610634f7cc772fc99d41`。主动删除生产 `nativeOIDCLoginOption` 的重复 challenge 拒绝判断，原新目标 session 31981 退出 1，输出 `ambiguous or malformed native login query exposed a login option`；原件 `cells-login-ui-production-mutation.log` 为 `44becbd8691bfc52440a6fc73ba7a3a85389cc90e9977593cb1c94e0b533b1e4`。apply_patch 逐字还原后 handler SHA-256 与变异前相同，为 `b9917f1fa4b1543d8d41e60a7638fcb26c554221a37a6b509cfb40bb5ccae4ee`；原完整窄目标 session 4835 再次退出 0，`cells-login-ui-restored.log` 为 `2471a8b7941633e09eaa15437a5a2e981e3808c337377227d11105a0ef9d0fea`。未运行产品镜像、真实 SSO、full 或部署，本节不扩大为三组件接入验收。

## 2026-10-06 三人正常原生 SSO 已部署验收

18:31 UTC，apps `afc462d836c770b6f402372b53cd05b3c203786a` 的 Cells 修正版
经原 builder 构建、原 registry 推送和独立 `deploy/start.sh` 投递均退出 0。
原 helper 计算源码摘要
`sha256:1547a9b78302988da3f7c986b48de73fcb064fb153b6ed7028db010284297aea`，
产物为 `sha256:e2bd0ea9fd61ca0d1d6d2f7d834519081ccdde6843c3bc6bb15f8511c2eec7d4`，
registry 读回及运行容器镜像一致。原版本命令打印该完整 apps commit、`5.0.3-dev`
及正确构建时间。Cells 为 4 CPU / 8 GiB，独立数据库为 2 CPU / 2 GiB；仅前者容器
被替换，数据库容器与数据未重建，两者 healthy 且 restart count 为 0。
构建使用原缓存挂载，但仍实际拉取基础层，不声称完全离线。

三位用户各用新建独立 Playwright 浏览器会话，从
`http://192.168.0.193:58092/` 原登录页面点击 Kailo，经过 IdP 本人账号登录及正常
callback 自动进入原生 `/welcome/`。没有改 URL、注入 token、重置密码或共用登录态。
页面身份读回及随后刷新读回完全一致：

| IdP 登录用户 | Cells 原生 UUID | 原生 profile / admin |
|---|---|---|
| kailo-bootstrap-admin | 1860170d-e93e-499d-8140-ce54011c29ab | standard / false |
| seam-verifier | 7f1849a6-a5cf-4c05-b8d1-2c1e478aa804 | standard / false |
| collab-third-20261005 | c8b9eb70-e840-4b5d-a372-4dc1a3a59de4 | standard / false |

原新手引导按 Skip 退出后，账户菜单显示各自用户名，Home、All Files、Bookmarks、
Personal Files、Common Files 等原生页面内容可见。三张截图已逐张打开复核，不是
HTTP 200 或容器健康推断。页面本身为顶层独立原生窗口（`window.top === window`）；
原页面有一个无 src 的 `about:blank` 内部 frame，不是 Kailo 以 iframe 承载组件页面。
本次三张截图仍为英文，默认中文与完整中英切换尚未验收；不能把本次 SSO 结果计为
语言要求通过。

原件目录 `/volumes/data/kailo/tmp/cells-callback-release-20261006.bxGWHg/`：
`build.log`、`deploy.log`、`three-identities-after-refresh.log`、
`01-admin-native-home.png`、`02-peer-native-home.png`、`03-third-native-home.png`。
运行配置仍是受控 owner-only 文件，不入源码；原 helper 的固定源码及匹配来源清单
保存在该目录的 `apps/`。本段不代表三服务完整接入、Web/Desktop 宿主入口、当前
平台 Workspace scope、ApplicationBinding、MCP 工具、资源或平台工作流已经验收。

## 2026-10-06 原生中文默认配置与个人语言切换

本次仅修正原运行配置，不改源码、镜像、身份或业务权限。权威为固定 Cells
`c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`common/utils/i18n/languages/i18n.go::AvailableLanguages`（简体中文为 `zh-cn`）、
`common/service/frontend/bootconf.go::ComputeBootConf`、
`idm/role/grpc/first-run.go::InitRoles` 与
`common/utils/i18n/languages/i18n.go::UserLanguage`。全局默认进入原 boot config；
原 ROOT_GROUP 默认语言进入用户角色继承，个人显式语言仍优先。没有新增语言权威。

实际旧配置与根组语言 ACL 均为词库未登记的 `zh`，所以先前截图回退英文。
原 `admin config set` 仅支持 services 三参数；首次把完整 frontend 路径传入被参数
检查拒绝，退出 1，没有写入。随后通过原生管理员正常登录、原 Main Settings 页面
选择“简体中文”并保存，精确读回 `frontend/plugin/core.pydio/DEFAULT_LANGUAGE=zh-cn`。
原 ACL search 确认 ROOT_GROUP / PYDIO_REPO_SCOPE_ALL 仅有一条语言默认记录后，
使用原 admin acl delete/create 替换该条，输出删除 1 条、创建成功；最终根组仍为
9 条，原 8 条读写 ACL 保持不变，新语言值为 JSON 字符串 `"zh-cn"`。
同一受控安装输入仅同步 `frontendDefaultLanguage=zh-cn`，避免新部署重新写入旧值；
不重新安装、不清库、不修改凭据。旧语言值已记录，必要时可经同一管理入口恢复。

三人正常刷新后的原 UUID、standard / false 均保持，`currentLanguage=zh-cn`；
原主页、所有文件、书签、搜索及账户菜单实际为中文。`seam-verifier` 再从原“我的帐户”
选择 English 并保存，原本人语言 ACL 读回 `en-us`，刷新仍为英文；再从原界面选
简体中文并保存，刷新读回 `zh-cn`、原本人 UUID 未变。首次英文保存发生约一分钟
等待后 `Could not store ACL / context canceled`，个人 ACL 回查未写入；按原页面重试
后才成功，失败日志保留。因此不能将这次成功切换表述为无超时或全功能稳定验收。

原件仍在本节前述 `cells-callback-release-20261006.bxGWHg/`：
`locale-config-readback.log`、`locale-root-default-{delete,create,readback-final}.log`、
`locale-user-save-failure.log`、`locale-peer-final.log`、
`three-identities-chinese-final.log`。截图 `04-admin-native-chinese.png`、
`05-peer-native-chinese.png`、`06-third-native-chinese.png`、`07-peer-native-english.png`、
`08-peer-native-chinese-restored.png` 已逐张打开。原创建的 Personal Files / Common Files
工作区名称属于现有业务数据，本次未改名；也未穷举原插件全部词条或所有管理页面。
本次无 build、full、新增检查或第二套 UI，原 e2bd0ea9 产物保持不变。

## 2026-10-06 独立实例凭据暴露处置与重新登录

此前操作误把原 `admin config list` 的位置参数视为路径过滤，实际输出了完整原生
配置；随后按文本行查单行安装 JSON 也暴露了其中凭据。第一次轮换后的对象比较
又因原 config copy 将 `defaults/sites/0/TLSConfig: null` 规范化为缺省而失败，
Node 断言打印对象，故第一次替代值不能视为安全完成。原失败输出没有删除。
之后先修正输出边界并经主线复核：对象比较只取布尔结果；异常仅固定 stage；
子进程标准输出和错误受控捕获，不显示配置、凭据或散列。再从真实规范化配置
建立新的 owner-only 备份，完成第二次、最终完整轮换，精确读回一致。

处置只涉及本独立实例的 PostgreSQL `cells` 角色密码、原本地运维用户
`kailo-platform-admin` 密码、frontend session secureKey、personalTokens secureKey
及原 OAuth global secret。三名 IdP 用户、OIDC connector、Vault 中的对象存储密钥、
其他服务、业务数据及权限不变。对象存储配置中的 ApiSecret 是已有 Vault 引用而非
实际密钥，不将引用字符串泄露错误扩大成无依据的对象存储轮换。密钥只在既有受控
配置投递文件中，未写入源码；备份及维护输入目录为 0700，文件为 0600。

原生运维路径为 masked `cells admin user set-pwd`、PostgreSQL masked `\password`、
同一固定镜像原 `admin config copy`。Cells 短暂停止写入，独立数据库一直保留；
配置替换后启动同一 e2bd0ea9 产物，没有镜像重建、清库或身份重建。
受控数据库、运维密码、安装 JSON 与 OAuth JSON 文件同步更新，原生配置与全部
mirror 的精确读回退出 0。原数据库角色权限不在本次变更范围。

OAuth 不能仅替换 secret：固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf`
的 `idm/oauth/provider.go::mapConfigValues`、`idm/oauth/dao-registry.go::KeyCipher`
及 `idm/oauth/dao/sql/jwk.go::{addKey,GetKey,GetKeySet}` 将原 JWK 密文绑定此密钥。
一次性维护程序直接复用已锁定 Hydra
`v2.2.0-rc.3.0.20240122114848-c9f4b5f3fbd7` 的
`driver/config/provider_fosite.go::DefaultProvider.GetGlobalSecret` 与
`aead/aesgcm.go::AESGCM`；原 provider 按既定 HashStringSecret 派生，未自实现密码学。
停止 Cells 期间，原唯一 JWK 行加锁、全行 CAS，仅更新密文。原/新解密字节完全相同，
JSONWebKey.Valid、kid 与公钥保持，旧密钥解新密文失败；原主键、set、version、
created_at 等元数据逐项保留，事务读回成功后 COMMIT。没有删除或生成替代 JWK，
也没有保留暴露的旧 secret 作长期 fallback。

迁移前原数据库 `IS JSON` 精确核对五类历史 session（总数 / 非 JSON）：
accesses 8/0、refreshes 8/0、codes 5/0、oidcs 5/0、pkces 0/0，因此未另迁移
不存在的历史加密 session；personal_tokens 原为 0。维护辅助程序第一次编译因
原 JWK Thumbprint 的指针接收者用法失败，修正后同一受限 SDK 离线编译退出 0。

最终真实验证：经原 `cells-db` 网络地址的新数据库密码登录成功，两代旧密码均
报 password authentication failed；原 `/a/frontend/session` 对本地运维新密码
返回 200 与真实 Token，两代旧密码均为 401。旧 frontend cookie 实际返回 401，
无 Token。三名原用户随后从原登录页面重新走本人 IdP 登录，peer/third 回调观察为
`/auth/kailo/callback` 303 → `/login/callback` 200；三人刷新后的 UUID 与本节前表
完全一致，均 standard / false、`zh-cn`，独立顶层原生页面正常显示。三张加载完成
截图逐张打开，未将较早的加载骨架截图算成功。保真重加密保留签名公钥，因此不
宣称已签发 JWT 在其原生到期前全部撤销；本次证明的是泄露凭据替换、旧密码/旧
frontend cookie 拒绝与正常新登录，不是三服务全业务或平台 binding/工具资源验收。

非敏感回执为前述 bxGWHg 目录 `rotation-final-safe-receipt.log` 与
`rotation-ready-{admin,peer,third}.png`。受控维护目录
`/volumes/data/kailo/components/cells/credential-rotation-final-20261006.N4myf1/`
保留恢复所需备份及原 JWK 事务诊断，内容不纳入 Git、不公开；初次暴露的维护记录
也保留，没有以删日志掩盖事件。本次未运行 full、未构建镜像，文档检查交主线合批。

### 2026-10-07 原生完整页面的受限嵌入来源

本批按用户要求恢复完整原生页面在 Kailo 内容区嵌入，不复制或精简 Cells UI。
四步影响结论：权威为当前原生页面宿主要求及设计 07 §4.6；接缝为原
IndexHandler/PublicHandler 的 `frontend.secureHeaders` 和原 OIDC 登录按钮。
状态仍由 Cells、原 OIDC/PKCE 与 Kailo binding 各自负责，没有新增业务状态或身份权威。
只有运行期显式 `KAILO_FRAME_ANCESTORS` 可以扩大父来源，空值逐字保留原 CSP/XFO；
非法来源 fail closed，嵌入不授予用户、数据或操作权限。

固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`cells/frontend/web/index-handler.go::IndexHandler.ServeHTTP`、
`cells/frontend/web/public-handler.go::PublicHandler.ServeHTTP` 原头部入口复用同一 helper。
保留原 CSP 其它指令与所有其它 secureHeaders；只有显式来源配置才移除冲突的
X-Frame-Options，改由精确 frame-ancestors 控制。允许显式 http/https/tauri
父 origin，拒绝通配、用户信息、路径、查询、片段、注入及无效端口。
原登录按钮只在 iframe 中使用独立认证窗口；原 href、PKCE、state、nonce、
回调和用户映射未改。Compose 与原 start 入口投递并检查同名运行期配置。

在既有 `kailo-cells-native-check-lftow7`（UID 1000、4 CPU/8 GiB）运行：
`GOPROXY=off go test frontend/web/kailo-frame.go frontend/web/kailo-frame_test.go -v`
得到 2 PASS、退出 0。仅 SDK 将 self 改成通配后两例均真实失败、退出 1；
从正式源码恢复并 cmp 0 后重跑 2 PASS、退出 0。日志位于
`/volumes/data/kailo/tmp/gateway-locale-repair-20261007.iwRGvX/`
的 `cells-frame.log`、`cells-frame-mutation.log`、`cells-frame-restored.log`。
这是原头部 helper 的专项证据，不是整个 Cells 编译、浏览器或部署验收。

随后交叉复核发现空配置会将原 `frame-ancestors 'none'` 替换成 self，已纠正：
空值或仅空白直接保留原 secureHeaders，不新增或替换 CSP，不删除 XFO。
在同一 SDK 补入原 CSP none、DENY、nosniff 逐字保留和无 CSP 原策略的断言后，
2 PASS、退出 0；删除空值 early return 的真实破坏使默认策略例失败、退出 1；
原字节 cmp 0 还原后 2 PASS、退出 0。最终日志为同目录
`cells-frame-preserve.log`、`cells-frame-preserve-mutation.log`、
`cells-frame-preserve-restored.log`，早一轮结果不替代本次修正后的证据。

剩余边界：未构建/部署本批，未验证新的 iframe 首次登录。
Cells 原生会话的 Strict 与 OIDC 事务的 Lax Cookie 未弱化；同站点不同端口
不等于 Desktop tauri 父来源下的跨站 iframe。后者仍需真实可用的安全 Cookie
交付方案，认证弹窗本身不能证明 iframe 已取得会话。此限制不以重复登录、
共享身份、复制 Cookie 或放宽 CSRF 绕过。

### 2026-10-09 固定 bb5d67e6 原生构建失败与独立账号基线

本次交付范围是已提交/push 的原 Job/Task 修复，不是创建新 Cells 实例或
激活未闭合的 FILE_STORAGE 类别。四步影响：apps/07 §2.1 受限原构建/
可追溯发布，以及设计 07 的原独立服务/数据库边界；影响原 manifest 的 native artifact
与 application-only 更新，安装/认证文件及数据库均保留；任何构建、
digest 或 native 版本确认缺失都不替换容器；失去确定结果不拿旧 tag
冒充新产物、不重建数据库或伪造 binding/Task。

原 sparse 构建候选
`/volumes/data/kailo/tmp/cells-native-release-20261009.wlO96u/apps`
固定 HEAD=`bb5d67e62364608e73aab56ca0f7b4718a78a38a`、源 status clean；
官方版本仍 `c57f02f4962835447df694c63bd0fd8c22bd7baf`。
原 manifest plan 对本候选得到 source digest
`sha256:4621e6a6da894edd613d6d441c701804237f0b1857af737bb5e1afe81ecfbecd`，
但失败构建没有关联新 artifact，不能把该输入摘要称作已发布镜像。

复用既有 `kailo-core-data` BuildKit、Data cache，8 CPU/16 GiB、无额外
swap，不下调 Go 并行、不新建 builder。原 Knowledge 构建也在该 builder，
不是独占窗口；启动前 MemAvailable 大于 16 GiB，原资源限额约束 aggregate。
原 builder lifetime memory.peak=16 GiB、max 计数是既有历史快照，不冒充
本批峰值；oom/oom_kill 仍 0。原 Dockerfile pinned frontend/Go/Alpine
镜像及 apk/Go 依赖确实进行了拉取，不声称纯离线或全部 cache hit。

真实原入口与投递（REGISTRY/密钥仍来自既有 operator `.env`，不打印）：

```text
BUILDX_BUILDER=kailo-core-data
CELLS_VERSION=5.0.3-dev
GIT_REV=bb5d67e62364608e73aab56ca0f7b4718a78a38a
BUILD_STAMP=2026-10-09T15:56:35
DOCKER_ENTRYPOINT_SRC_DIR=tools/docker/images/cells
./tools/build-upstream.sh file-storage-service
```

原句柄 77075 最终实际 exit 1，没有重复启动。真实失败在原
`go build -mod=readonly -trimpath` 的锁定依赖下载，原输出包括：

```text
github.com/blevesearch/bleve/v2@v2.5.7: Get "https://proxy.golang.org/github.com/blevesearch/bleve/v2/@v/v2.5.7.zip": net/http: TLS handshake timeout
gocloud.dev@v0.45.0: Get "https://proxy.golang.org/gocloud.dev/@v/v0.45.0.zip": net/http: TLS handshake timeout
ERROR: failed to build: failed to solve: process ... did not complete successfully: exit code: 1
```

完整原件位于候选上级 `cells-native-release-20261009.wlO96u`：

```text
8a88e4dab86e13c8c1ec93944e1e2583a00473a65a3736646220e37816b2df04 build.log
14bebe7ed2109547470673a2eb62e855403025c91f8b0daac45102041f7127c8 build-file-storage-service.QRn8T2.log
```

因此没有新 Cells binary、artifact digest/registry push 或部署；正式
upstream.yaml 两个旧产物摘要不改，旧 native app
`kailo-cells-native-cells-1`/image `sha256:e2bd0ea9fd61ca0d1d6d2f7d834519081ccdde6843c3bc6bb15f8511c2eec7d4`
与原数据库/认证/业务数据均未变更。原 start.sh --check 对既有受控
投递检查退出 0，不等于新版构建/部署成功。原 Dockerfile 不 bundle
frontend JS，未来此 native 构建即使通过也不能代替 JS/browser 更新证据。

等待构建期间，原 normal browser 会话从 Cells 登录页走本人 IdP，未注入
Cookie、未重置/共享身份：`kailo-bootstrap-admin` 回读 native UUID
`1860170d-e93e-499d-8140-ce54011c29ab`，`seam-verifier` 回读
`7f1849a6-a5cf-4c05-b8d1-2c1e478aa804`，两者均 standard/admin=false。
原 `PydioReactUI.JobsStore.getInstance().getJobs(true,"Any")` 在 admin 的
旧版正常会话读取为 0 jobs/0 tasks，没有制造任务作验收。第三既有账号
本轮未找到已投递登录密码，明确 SKIP，不用其它 Tenant 管理员凑数。
这些只是旧版两账号独立入口/身份与原任务列表只读基线，不是新 bb5 字节、
三人协作、claimed Task 重启恢复、Mongo/S3 实库或平台 binding E2E 验收。
本轮未运行 full；此前 full 22988 exit 2 于 Dart pub.dev socket 依赖阶段，
后续门禁未运行，不以本回执宣称生产就绪。
本次原 `./tools/check-docs.sh` 首轮在容器 launcher 因未投递 TMPDIR
实际 exit 2、七项文档检查未启动；文档门禁未宣称通过。

## 2026-10-09 原生完整 UI producer→Go embed 源码 checkpoint（未产物验收）

1. 权威及固定原消费者：`.design/07` §4.6 要求复用完整独立原生页面，
   apps/07 §2.1 约束受限构建。Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf::frontend/assets.go::EmbededAssets`
   用原 `go:embed assets`，在 Go 编译时固定页面资源；原
   `frontend/assets/gui.ajax/package.json::scripts.build-boot-prod`、
   `scripts.build-core-prod`、`scripts.build-libs-prod`、`scripts.build-css-prod`
   及其它 workspace 的 `scripts.build` 是实际 webpack producer。
   原 `build.sh` 只拼错全局安装 pnmp/执行 install；原 build-modified.sh
   依赖 Git 脏文件且排除 gui.ajax，均不能交付冻结源码的完整 UI。
2. 影响：原 build.sh 现在校验原 packageManager 的 pnpm 10.7.1，按原
   frozen lock 安装开发工具链，再以 production 执行 GUI 四 producer
   与其它 28 个原 workspace。按 `pnpm-workspace.yaml::packages` 的
   `*.*` 路径逐包执行，避免 editor.soundmanager/editor.diaporama 的
   重复原 package.name 或 meta.versions 的 meta.git 名称漏包；不改名、
   不删原布局/页面/样式/交互。原 webpack-commons.js::configLoader
   实际消费而 root 未声明的 Babel dynamic-import 7.8.3、TypeScript
   preset 7.28.5 加入原 root package/lock importer；复用原锁已有
   integrity/snapshot，不升级其他版本。没有业务数据库、公共契约或身份迁移。
3. 副作用：原 Dockerfile 增加固定本地 Node 22.23.3 Alpine digest
   `sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402`
   的原前端构建 stage（原工具 bash/git）；其完整 assets 去除
   node_modules 后替换 Go stage 的旧 embed 树。原 production clean
   清掉的过时 chunks 不由旧树重新覆盖。Bash -e/pipefail 保留 build
   或任一 tar 管道失败，不用旧预编译文件降级出成功镜像。没有第二套
   前端、外部 runtime 页面目录、权限/队列/账本或 ApplicationBinding 激活。
4. 异常与边界：管理器漂移、锁不同步、缺包、prepare/webpack/导出失败
   均阻止 Go 产物消费；两 Git SDK 仍固定原锁的 HTTPS archive commits
   a68409a2a6494834f92c997d1e67e8ed470ca70a 与
   cbea7de85ff1ac4602a86e8196d583b9ef6c9893，不回退浮动 next/v5-dev。
   不忽略 prepare、不关闭 TLS、不换 registry；git 工具不表示本轮实际
   使用了 clone，原锁无 SSH URL。HUSKY=0 仅关闭 source-only release
   的开发 Git hook 安装，不改组件运行期认证。write/delete/share、
   staging writer 退休与完整七键类别准入既有门禁没有解除。

实际复用已有 `kailo-cells-login-ui-node-20261005`，UID 1000，4 CPU/
8 GiB、swap 0；现有 assets/node_modules 与 Data npm/pnpm-memory-read
缓存均保留，无新 SDK、builder 或全仓复制。原缓存仅实际安装过
core.authfront，不能称完整前端已缓存。初次预检 SDK 29 MiB、OOM 全 0，
host available 25 GiB；原源码增量同步后 build.sh/package/lock/PydioApi
四输入 cmp 0。SDK Node 实际 24.21.0，不是 Node 22 镜像验收。

原完整入口命令在 SDK `/workspace/assets`：

```sh
npm exec --offline --yes --package=pnpm@10.7.1 -- bash ./build.sh
```

投递 `npm_config_cache=/cache/npm`、`npm_config_store_dir=/cache/pnpm`、
`npm_config_offline=true`、`CI=true`。62846 实际 exit 1：30 workspace
projects（root + 29），921 锁包、lock resolution skipped，但原缓存缺
`react-joyride@1.11.4`，`ERR_PNPM_NO_OFFLINE_TARBALL`；未进入 webpack。
原件 `/volumes/data/kailo/tmp/codex-component-runtime-integration-20261005.lciVUS/cells-native-frontend-bundle-positive.log`
SHA-256 `f47a23aa3f094ebed0e003434bc100993d890015a0917b43ac310e2ba646b805`。

经主代理明确允许同一 cache 按原 frozen lock 获取缺失包，唯一正常
续验 38929 的 cached npm wrapper 仍用 offline pnpm 10.7.1，其原
build.sh 子进程改用 `env npm_config_offline=false`；源码输入不变。
原件同目录 `cells-native-frontend-bundle-locked-online.log`。截止本节
17:33 UTC，原 921 锁包安装尚未终态；已记录 Git-pinned cells-sdk-ts
的原 npm prepare 中 `tsup: not found`/127，不能写成整命令退出码。
根因是安装前 NODE_ENV=production 传入 nested npm；正式源已改为
`NODE_ENV=development pnpm install --frozen-lockfile --prod=false`，
安装后才切 production，未修改在途候选。最终 NODE_ENV 与 Docker
git/Bash 修正尚未重跑。最近 SDK cgroup 903 MiB、OOM 全 0；保持原句柄，
没有启动第二安装、Go/Cargo、镜像构建、数据库或部署。

本 checkpoint 仅源码接线与上述真实失败/在途事实：bash -n 和 owned
diff --check 实际 exit 0；完整 32 webpack producer、生产变异/还原、
新 bundle/Go embed binary/image、浏览器与部署均未据此验收。
upstream.yaml 原 artifact/source digest 不伪造更新，原 live Cells/数据库/
认证/业务数据未变。full 41490 属主代理另一固定输入且实际 exit 1，
不借其阶段输出宣称本前端通过，也不重跑全局门禁。

## 2026-10-09 完整 producer 终态与原活动流缺件恢复

本节续接 `f1862706d4a9d3de146e316f12f0730293c8eac7` 的真实验证，不改
其固定 Cells 基线 `c57f02f4962835447df694c63bd0fd8c22bd7baf`。
旧 38929 最终 exit 1，原 Git-pinned SDK 的 `npm install` prepare 报
`spawn ENOENT`；它不是此前内层 `tsup: not found`/127 的整命令退出码。
原日志 `cells-native-frontend-bundle-locked-online.log` SHA-256
`afe69801ae6fcf24e3528ab27949d970107a8881a305ca11920872f300149c34`。

最终 f186 输入已在同一 SDK 冻结，未混入后续编辑器保存修复：

```sh
sudo -n docker exec --user 1000:1000 --workdir /workspace/assets \
  --env npm_config_cache=/cache/npm --env npm_config_store_dir=/cache/pnpm \
  --env CI=true kailo-cells-login-ui-node-20261005 \
  npm exec --offline --yes --package=pnpm@10.7.1 -- \
  env npm_config_offline=false bash ./build.sh
```

46339 最终 exit 1：原 921 锁包安装在 3m52.7s 结束，reused 907、
downloaded 1、added 1；不是纯离线。boot/core/libs/CSS 与原 access.gateway、
access.homepage、access.settings、action.compression、action.share、action.user
已进入实际 webpack 并编译；第 11 个原入口 core.activitystreams 在
`res/js/index.js:30` 不能解析 `./UserPanel` 停止。全部 32 producer 不通过。
原日志根目录仍为
`/volumes/data/kailo/tmp/codex-component-runtime-integration-20261005.lciVUS`，
`cells-native-frontend-bundle-final-source.log` SHA-256
`ea3d42c42d54849f9eca79e958068f678979ca836d1cc1279e3c9451b6233b01`。

本次实际源码恢复的四步影响：

- 权威：用户固定原版恢复要求与 `.design/07` §4.6、DD-87 的完整原生
  前端要求。固定 c57 的
  `frontend/assets/core.activitystreams/res/js/index.js::UserPanel` 保留
  import/export，`git ls-tree` 没有其源文件；这是上游 source/dist 缺件，
  不是授权删除面板或变更固定基线。最后保留原源码的完整提交是
  `ae047e260516f2a0139bc910e1cf0f045fdeed0b`，完整路径
  `frontend/front-srv/assets/core.activitystreams/res/js/UserPanel.js::UserPanel`，
  blob `21dea15c61a69ee15bbe9835a853e22a7d248355`；官方提交
  `2ed6070924fa9f93dc810bd22df12c602ca18e5e` 删除此文件却保留入口。
- 影响面：原样恢复 149 行到当前 `core.activitystreams/res/js/UserPanel.js`；
  原 `index.js`、`gui.ajax/res/js/ui/Workspaces/leftnav/UserWidget.js::render`
  的 AsyncComponent/PydioActivityStreams.UserPanel 与原 manifest 加载链
  不变。固定 c57 的
  `frontend/assets/core.activitystreams/res/dist/PydioActivityStreams.min.js`
  blob `f7a5a5f60ef3cb94742411916b4920ebd5fecf61` 仍含导出 UserPanel 与
  `ht` 的 reloadData/reloadUnread/render/muiThemeable 实现；恢复来源与其对应，
  不另写相似面板。唯一相对历史源码的字节差异是补 EOF 换行。
- 副作用：不改原 UI/文案/样式、原 ActivityServiceApi 消费、身份或 ACL，
  不增加 API/schema/状态/凭据/队列/平台权威。没有数据库迁移适用对象。
- 异常：缺件仍由真实 webpack 消费者拒绝，不隐藏原通知入口，不用旧 bundle
  冒称完整新 producer 成功；尚未构建的原插件、Node22 镜像、Go embed、
  实际页面与运行期授权不借本插件编译推断通过。

定点复用原 SDK UID1000、4 CPU/8 GiB、无额外 swap；`cpu.max=400000 100000`，
开始时仅 sleep、memory.current 32.8 MiB、OOM 全 0；host MemAvailable
22584612 kB，I/O some avg10 38.89%，记录真实其它主线在途，不声称宿主独占。
未安装新依赖、未新建 SDK/镜像或启动 Go/Cargo/full。SDK 实际 Node24.21.0
仍不等于 Docker Node22 stage 验收。原定点命令：

```sh
sudo -n docker exec --user 1000:1000 --workdir /workspace/assets \
  --env npm_config_cache=/cache/npm --env npm_config_store_dir=/cache/pnpm \
  --env NODE_ENV=production kailo-cells-login-ui-node-20261005 \
  npm exec --offline --yes --package=pnpm@10.7.1 -- \
  pnpm --dir core.activitystreams run build
```

74067 正向 exit 0，真实 `PydioActivityStreams.min.js` 48.5 KiB，14661 ms。
随后仅在私有 SDK 用 apply_patch 删除真实 UserPanel 源，71199 同目标
exit 1、1120 ms，实际再次命中原 index 的缺依赖；正式源未破坏。
按上述原源码 apply_patch 精确还原，正式/SDK cmp 0，27479 同目标
exit 0、1271 ms。末次 memory.current 95.3 MiB、memory.events 全 0。
三原件依次为同日志根目录下：

- `cells-native-activitystreams-restored-source-positive.log`，SHA-256
  `726e5e871cfe6a0145fed1286e668beb742d1eec081cf32b9f7fbb851913b99a`。
- `cells-native-activitystreams-restored-source-negative.log`，SHA-256
  `cf3c2b16e4764cf5e349a10a3038a5f8802dbbb1244ef29cae7e91fe344e3d3f`。
- `cells-native-activitystreams-restored-source-restored.log`，SHA-256
  `c16bca09bae3fb4c1531a82a0343f91b8f6692fc275f5417dfb1825e8c5eb4e9`。

恢复源码 SHA-256
`a27934bcda51b7cb2cdc9291bfa97ab95c7cc6da64d43aa078ce9e599dcde069`。
仅此原插件定点正反还原通过；完整 producer 未重跑、完整 bundle/image/
Go embed binary、浏览器与部署均未验。实际 live Cells、独立数据库、认证、
业务数据及原 artifact digest 不变；本节不解除七必选、首传 CAS、writer/
Task 安全退休、HUMAN 正文交付、批准 release/binding 的既有发布门禁。

## 2026-10-09 原生 TaskID 精确查询（源码与生成链）

四步影响结论：

1. `.design/03` §6 的 ExternalExecution 冻结原生引用与 UNKNOWN 对账、
   `.design/18` 的 Cells 独立业务权威决定本次边界。固定 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `scheduler/jobs/dao.go::DAO`、`scheduler/jobs/dao/bolt/bolt.go::ListTasks`、
   `scheduler/jobs/dao/mongo/mongo.go::ListTasks` 与
   `scheduler/jobs/grpc/handler.go::JobsHandler.ListTasks` 是原持久化/查询接缝。
   `tools/upstream_manifest.py status file-storage` 实际输出 HEAD 即上述基准，
   无新提交。受控 Task 保留历史后，全 Job 枚举会耗尽一次查询的响应预算，
   不能靠增加 MaxResponseBytes 或提前删除原生回执修复。
2. 原 `common/proto/jobs/cells-jobs.proto::ListTasksRequest` 新增可选
   `TaskID=3`，原 JobID/Status 字段不变。两个原 DAO 按同 Job/Task 精确读取，
   原 gRPC handler 消费字段；`ReadNativeWriteTask` 实际发送固定 key。
   空 TaskID 的原列表、状态筛选及其他调用方不变；无数据库迁移、新状态、
   新平台实体或 `contracts/` 四语言数据契约变更。Web/Desktop/Mobile 的
   管理面和组件宿主边界不变，没有新增客户端入口。
3. 不复制业务正文到 Core、不改变认证/授权/额度或 Task 生命周期。保留
   原 StripTaskData 与冻结任务回执。旧服务忽略字段并返回非目标任务、
   重复任务、截断流或错误流时，不返回已匹配的部分 Task；仍按原预算拒绝。
   只有正常 EOF 才证明本次查询结束，查询错误不推断副作用失败或允许重放。
4. 空 Job/key、取消、损坏行、同 key 不同 Job、未知/不匹配结果和超限都有
   原错误返回；零条目仅在成功结束的原存储查询后返回空。普通列表的未知
   status 语义未扩大。对应 apps/06 §4：参数/运行前提为 PRECONDITION，
   大小界限为 LIMIT，引用不匹配为 CONFLICT，外部观察失败维持 UNKNOWN；
   原 DENIED/BLOCKED 门禁没有解除。并发写、撤权、租户暂停、审批间额度
   变化仍由原准入与在途对账控制，此只读查询不创建或重放副作用。

生成复用原 jobs `buf.gen.yaml` 与 `buf.gen.tag.yaml`；固定上游未提供
buf CLI 版本，因此本次工具固定官方
[buf v1.50.0](https://github.com/bufbuild/buf/releases/tag/v1.50.0)，Linux x86_64
二进制由同 release 的 sha256.txt 校验，实际 `buf-Linux-x86_64: OK`，摘要
`154ea883ce098eac4fa106ff9ee4e4964bb97f809dd8ec9c34a432b466ce1494`。
Go 插件来自本项目 go.mod 的 protoc-gen-go v1.36.11、go-grpc v1.5.1，
setter 来自本树 `cmd/protoc-gen-go-setter`，没有安装上游脚本中的 stub@main。
setter 首次 readonly 安装因自身 go.sum 缺三个已锁版本 checksum 失败；
原私有 SDK 离线 mod=mod 仅补 x/mod v0.35.0、x/text v0.37.0、x/tools v0.44.0
的 checksum，go.mod 逐字未变，正式 go.sum 与实际产出 cmp 0。
buf 初次默认缓存写 /.cache 被 UID1000 拒绝，投递
`XDG_CACHE_HOME=/cache/build/kailo-proto-tools/cache` 后原两模板 generate
实际 exit 0；setter 生成物与原文件逐字相同。两个 protobuf Go 文件为原工具
实际输出；生成头从历史 v1.34.2 更新为当前已锁插件，不能手改生成物缩减 diff。

实际复用 `kailo-cells-native-check-lftow7`，UID1000、4 CPU/8 GiB，
MemorySwap 与 Memory 同为 8589934592；没有新建 SDK 或降 Go 并行度。
已有 Data module/build cache 保留；执行前核对原 SDK 仅 sleep，宿主可用
内存约 26 GiB，最终 memory.events 的 max/oom/oom_kill 全为 0。
初轮编译/链接遇到持续磁盘等待，保留原句柄直到退出，没有重复启动。
原命令在 SDK `/workspace/file-storage`，投递 `GOPROXY=off`、原
`GOMODCACHE=/cache/mod`、`GOCACHE=/cache/build` 与
`CELLS_WORKING_DIR=/cache/build/native-test-state`：

```sh
go test -mod=readonly -tags=storage ./scheduler/jobs/dao ./scheduler/jobs/grpc \
  -run 'TestDAO_ExactTask|TestNative' -count=1 -v
```

74250 正向 exit 0，两个包实际输出 `dao 0.071s`、`grpc 0.903s`，
10 个顶层、138 个子目标通过。其后仅在私有 SDK apply_patch 撤掉生产
`ReadNativeWriteTask` 请求的 `TaskID: key`，用同 grpc 原目标
`-run TestNativeTaskLookupUsesOriginalStreamTermination -count=1 -v`
重跑；4574 实际 exit 1，准确失败于
`exact-key-is-independent-of-unrelated-history`，输出
`unrelated native history blocked this operation's observation conflict`。
这不是修改断言或让编译报错；真实列表查询漏筛任务造成回归。
随后 apply_patch 原样恢复生产请求，与正式源 cmp 0，生产文件 SHA-256
`28de9ff49013ddc066ec98e91f1fb0486e5cb56b178a8a1b77782ba641a4d2bb`。
补齐原检查文件唯一一处 gofmt 空格后，50730 原完整窄目标复验 exit 0：
`dao 0.063s`、`grpc 0.944s`，仍为 10 顶层、138 子目标通过，gofmt -l 无输出。

三份完整原件位于
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/native-go-cache/`：

- `cells-exact-task-positive.log`：
  `2a0f2da5fbd3a23ee168e8bf562860ba019ce12652b02644149c3b9bcc38687b`。
- `cells-exact-task-negative.log`：
  `9418b48d0985fd80279886164973b7abc11f2a96437968365b8f469a8d02e17e`。
- `cells-exact-task-restored.log`：
  `184e2d60b1ea78f74bbb95f12f869365e50f40eedd791527f7eded16ccb191d4`。

实际运行原 Bolt 存储与进程内真实 gRPC stream；原 Mongo 实库用例由
`CELLS_TEST_MONGODB_DSN` 条件控制，本 SDK 未配置而未执行，Mongo 仅编译，
不能声称实库验收。原 fixture 的日志 driver 未注册警告如实保留，不证明
运行期审计输出可用。未执行 full、产品镜像、部署、页面截图或平台绑定
E2E；它们由整体交付另验。本回执不解除 FILE_STORAGE 七必选能力、
首次上传、writer/Task 安全退休、HUMAN 正文交付与 release/binding 门禁。

## 2026-10-09 HUMAN 固定版本原请求读取（源码检查点，未部署）

本批只贯通原生固定版本 read/export：`PydioApi.openVersion` 原入口经
Cells `pydioObjects.GetObject` / `GetObjectNInfo` 读取一次源内容，沿 Core 原
NativeHumanAction 准入、原 usage outbox 计量并重新检查 HUMAN 后交付。
没有恢复完成普通预览、未固定版本下载、Range、归档或列表页面动作，
没有以本批宣称 FILE_STORAGE 全能力、三端或生产验收。
原版本按钮/布局未重写；调用改为携带原 request key 的同源 fetch 与本地
blob 下载，以便错误不会被隐藏表单吞掉。跨源 presigned URL 与原移动
浏览器跳转方式未验证/未支持，不以这个调用改造宣称全宿主原版一致。

变更前四步与实际边界：

1. 权威是 `.design/03` §6 HUMAN APPLICATION 同请求 SYNC 分界、
   `.design/05` §6 CHECK/STRICT 边界与 `.design/18`。固定 Cells 官方版本
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `common/nodes/version/handler-version.go::(*Handler).GetObject`
   原本 HeadVersion/Location/GetObject 同步读，不要求创建 Task。本批不改
   REMOTE_ADAPTER v1 execute/ExternalExecution/Temporal 与 Agent 路径。
2. 影响到原 NativeHumanAction 入站、AE/ActionToken/PEP、usage writer、
   maintenance 与 binding disable 屏障、Cells 原认证/GetObject、原版本下载
   调用。新增 readAdmission/readReceipt 为既有契约可选分支；旧请求不变，
   新回执单独 closed schema 且生成四侧。Core 仅保留固定 inputReference、
   token stamp、billing pin、字节数/摘要/时间/计量回执，不存正文、下载链接
   或第二份结果。Web/Desktop 不增加另一组件页面；Mobile 不承载组件。
3. 原请求先持久化 AE，再锁行 claim UNKNOWN，最后记录唯一签票；重试和
   observation 不签第二张票。Core 落原回执/outbox，只有 stored_at 对应
   COMMITTED 才写终态。Cells 的原请求只重交同一份不可变计量回执，绝不
   重读源。HUMAN 再授权和原生 ACL 均在正文交付前复核。GetObjectNInfo
   先完成上述链再返回 reader，避免 HTTP 200 或空文件绕过消费检查。
4. 缺 proof/身份/binding/原生归属/版本/计量返回拒绝；无对象、Range、超限
   或实际长度不符不交正文。并发同 key、丢签票 ACK、读中断和超时保持
   UNKNOWN，不重读或伪造零用量。startedAt 必须在原 token 有效期内，
   completedAt 可晚于 token.exp，合法开始后已发生用量不会因过期丢弃。
   对应原六类错误为 PRECONDITION/LIMIT/CONFLICT/DENIED/BLOCKED/UNKNOWN，
   不增加未知错误枚举。

未 claim 的 ALLOWED/NOT_DISPATCHED AE 使用创建时冻结的原 tokenSeconds
截止；与 signer 持同一 AE 行锁，过期后原 audit terminal FAILED +
ADMISSION_ABANDONED（原封闭 reason）结束。数据库禁止已 claim 再变
NOT_DISPATCHED，防止“未执行”推断被状态回退破坏。已 claim、签发或结果
不明者不适用该终结，只收原回执。缺真实回执时原 UNKNOWN 度量/audit 与
binding 排空屏障持续可见，不能自动判为成功/失败；当前未提供能凭真实
补充证据终结无回执读取的独立人工消费者，因此此项仍属发布阻断，由平台
治理与 Cells 组件运维共同处置，不将无限等待称为已交付。

Quota 沿原 ActionDefinition：NONE 仅无 meter，CHECK 读取 OpenMeter；
STRICT 没有完整 producer/最坏上界证据即 CapabilityBlocked。依据
`.design/05` §6，并非为 SYNC 绕免预留。本读取链没有创建 reservation，
无执行过期不产生 usage 或虚构 release；已读内容沿同 operation 计量。

原 binding delivery 的 read.human 实际消费者要求 actions 中现有 action
版本/nativeType/resultExposurePolicy ID 与版本，可选 workspaceId，以及
receiptPollInterval。后者为正 duration、严格小于原 requestTimeout；
后者同时限制原请求中计量回执的总等待。只对 503 重交相同 metadata；
4xx/错误 ACK/撤权/取消/期限结束都不交正文。初次 OpenMeter ACCEPTED
不等于入账；即使请求结束，原 durable outbox 继续同 ID 对账，不重读源。
未投递上述配置或未通过原 release/binding 不开放平台正文入口；独立原生
安装不被切换成 Kailo 身份，没有新增默认不安全上游开关。

已实际证据：原 tools/gen.sh 固定 quicktype 生成四侧，最终生成 exit 0；
原 gen --check 四侧与 Mobile catalog 一致。首次并发复制未结束就生成
遇到空 schema 而失败；其后缺 Dart formatter PATH 令 i18n 检查失败，
补齐原 /usr/lib/dart/bin 后通过，未改生成器或手写产物。TS 第一次
roundtrip 因检查重建字段遗漏新增分支 51/52；修正检查后 52/52 通过。
原 Dart roundtrip 46/46 通过，两个命令的共同执行句柄 72246 最终 exit 0。
原 Worker Go `go test ./internal/contracts -run NativeHuman -count=1 -v`
句柄 6927 最终 exit 0：`TestNativeHumanActionRoundtrip` PASS，包耗时
`0.002s`；链接与落盘耗时不算产品功能完成率。
原 tools/check.sh 的 step_contract 在同 SDK 直接复用（不另装依赖），
句柄 8095 最终 exit 0：四侧生成物同步；相对 contracts-v0.1.0
`无破坏性变更（193 个 schema，匹配 3 个历史 schema）`。这只覆盖原发布
基线存在的历史项，并不冒称执行了完整 check.sh --full。

独立验证库 kailo_native_human_read_20261009 来自原验证 PG 模板，无业务
AE，不触碰现网；本新增 migration down/up 最终 exit 0。原检查文件中的
SQL fixture 使用实际安装的 production trigger，最终正向 exit 0；在同
事务把真实 guard 的 BEGIN 改成 BEGIN RETURN NEW，负向 exit 3：
`ERROR: accepted claim reset without no-execution evidence`，退出自动回滚
该破坏，原检查还原复验 exit 0。这验证回执字段/归属/不可变与 claim
单调性，不等于整个 NativeHumanAction/OpenMeter 真实集成验收。

原 Cells SDK 4 CPU/8 GiB 与 Data module/build cache 复用。首轮旧快照在
链接阶段运行约半小时，因本批真实修复改变输入，仅停止该自有检查
（exit 130）后集中同步最终源码；未停止其他项目，未删缓存。最终 Go
句柄 48401 已实际 exit 0：`common/auth` 0.262s、`common/auth/protocol`
0.025s，HUMAN admission 8 个场景与 completion 10 个场景（含首次计量
ACCEPTED 后确认、计量超时、撤权及错误终态）均 PASS。`scheduler/jobs`、
`gateway/data/gw`、`gateway/data/hooks` 编译通过但报告 `[no test files]`，
不能称其真实网关链已验收。完整原件为原 cache 中
`cells-human-sync-positive.log`，SHA-256 为
`e20e06075628c7f15aa5734fd543ef77067dbfaa33022775b5c2055df60abfbb`。
随后仅在隔离 SDK 源码移除 `CompleteHumanRead` 的 COMPLETED 门禁，
原 completion 检查句柄 24500 实际 exit 1：
`native-human-read_test.go:190: completion pending got <nil>`。这是真实生产
对象破坏，不是改测试预期；正式源码没有被破坏。已还原隔离文件且与正式
源码逐字 cmp 0，还原复验句柄 61226 实际 exit 0，原 HUMAN admission 8
场景与 completion 10 场景全部 PASS，`common/auth` 0.137s；原 cache 保存
`cells-human-sync-negative.log` 与 `cells-human-sync-restored.log`。
首次负向命令曾因 login shell
重置 PATH 报 `go: command not found`（exit 127），不算有效负向证据；
使用原 Go PATH 后才得到上述 exit 1。当时 Rust 验证的终态尚未收齐，
后续实际结果见下；真实页面/计量 E2E 未执行，本段不证明部署或安装包更新。

实现后交叉复核发现 ACK 的 `receiptDigest` 只查长度不能证明关联本次回执。
已在实际 `CompleteHumanRead` 消费者改为比对本次 receipt 的完整摘要，
沿 `.design/03` §8 和 Worker `component_conformance.go` 的既有 canonical
JSON 规则：键排序、精确保留整数、UTF-8、无 HTML 转义，并区别 U+2028/
U+2029 与字面反斜线转义。没有新增结果协议或结果存储。实现后增加合法
64hex 错误摘要拒绝用例，以及显式 canonical 字节 oracle（大于 2^53 的
整数、乱序嵌套 struct、HTML 和 Unicode 转义）。原 18 场景正反还原证据
不替代该后续修复验证。本次摘要正向检查句柄 69478 实际 exit 0，
admission 8、completion 11 子场景及 canonical 独立字节 oracle 均 PASS，
`common/auth` 0.371s。随后只在隔离生产消费者将摘要相等退回长度相等，
真实负向句柄 29181 实际 exit 1，准确抓到
`native-human-read_test.go:200: completion wrong-digest got <nil>`；
已还原隔离生产校验并与正式 cmp 0，还原复验句柄 56466 实际 exit 0：
admission 8、completion 11 子场景和独立 canonical oracle 全部 PASS，
`common/auth` 0.137s。最终 Go 两文件与 SDK 一致，原 SDK gofmt 已回写。
completion 的服务器摘要复用函数不作为独立算法 oracle；独立依据是另外
一项测试中固定写出的 canonical JSON 字节与其 SHA-256。
Core 原句柄 90990 保持原冻结输入，不被这次 Go-only
修正改写，已实际 exit 0：`cargo test --manifest-path core/Cargo.toml
-p platform-core -p contracts` 完成，platform-core 360 passed / 0 failed /
48 ignored，contracts adapter 2 与 roundtrip 46 全部通过；集成测试入口返回
绿色，但本次没有确认 `PLATFORM_INTEGRATION=1` 与完整业务依赖实际执行，
因此不作为真实业务联调通过证据，两个外部 drill 保持 ignored。
新增 native_read 完成证据与首次签票不可重放
两项单元通过；SQL fixture 在此 cargo 命令中按环境 ignored，实际数据库
正反还原证据见上文，不混为该命令执行。本次编译另纳入主线原生 Tool 候选
三个文件，不意味着其 PG/SpiceDB 真实候选撤权链通过；这项仍未执行。
原件 `/volumes/data/kailo/check-cache/cells-human-sync-core-positive.log`。
SHA-256 为 `156c71cd64158c3511f2b3ee659056de01736628db9e8159f71f01d961784927`。
终态后按工程 Rust 2021 在同 SDK 对本批及主线三个文件格式化与 `--check`
退出 0；只把 `application_action.rs` 的 import/assert 换行回写正式源码，
主线 Tool helper 的纯格式差异也已同步，未重复语义不变的编译。

此检查点仅交付 HUMAN 固定版本原生读取的上述源码与定向证据；没有执行
该最终树的完整 `tools/check.sh --full`、真实 Cells/Core/OpenMeter E2E、
页面截图或部署。当前 34 个自有路径不含 `main.rs` 的继承 custom emoji
改动、不含继承 compose 配置；由主线选择性提交，不将其余 dirty 带入。

## 2026-10-10 SERVICE SOURCE 固定版本正文消费者

本批接续 `9acfbddda298dcbe0dab30f79b9786c67eeeff91`，不改变其 HUMAN
同步读取。来源是固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf`
的 `common/nodes/version/handler-version.go::(*Handler).GetObject`，继续以
HeadVersion、VersionId 和原生 GetObject 读取，不重写文件存储。

1. 权威：`.design/07` §8.2、`.design/13` §4.1/4.4 与
   SS-CEL-MATERIALIZATION 已要求接收方自拉。现有 WeKnora 消费者取得
   SERVICE ActionToken 后调用来源 adapter；但 adapter 的版本下载没有把
   proof 传到原生 GetObject，原生端只接受 HUMAN/AGENT，无法交付真实正文。
   本批只补来源端固定版本正文，不新增 Core 权限、状态、实体或协议。
2. 影响：`protocol.AuthorizeSourceRead` 消费 Core 既有三字段 SERVICE PEP
   响应，成功校验原 AE/operation 后才能消费 claims；它不把该响应伪造成
   HUMAN targetResource。原数据网关消费 proof、保留实例原生身份，以签名
   authorizationTargetNativeRef 与原 GetObject 的 root/admitted/member
   UUID/路径/ACL 约束共同限制正文。adapter 要求原生 exact SERVICE 身份回显。
   Web/Desktop 仍使用原组件完整页面；本批没有改页面或 Mobile 承载边界。
3. 副作用：复用原 create-only read Task，记录同一 SERVICE actor、AE、
   operation 和固定版本；重复 key 在打开原生 reader 前拒绝。正文与摘要仍
   留在原请求和 Cells 原 Task，Core 只收原 SOURCE 元数据回执。实例凭据不交
   给 WeKnora，不把 SERVICE 映射成 HUMAN/AGENT，不产生第二份权限账本。
4. 异常：缺 proof/原生 ACK、错误身份、旧原生忽略 proof、范围或版本不符、
   PEP 不可达/撤权、超限、Task ACK 不确定均拒绝正文；零字节也须原 Task
   真正完成后 GetObjectNInfo 才返回 reader，不能通过空流绕过门禁。错误沿
   既有拒绝与 UNKNOWN 处理，不伪造成功或零用量。不改变 SERVICE 列举的
   两次完整遍历、HUMAN 同步计量或 AGENT ExternalExecution 语义。

实现后按实际 `contracts/adapter/file_storage.v1/read_input.schema.json`
复核，原生 SOURCE 输入严格只收五个字段；不能因通用 ContentReference
允许 `assetId` 就在此额外兼容。相应场景须拒绝多余字段，Core 的原输入相等
与 schema 校验保持不变，没有修改或重新生成公共契约。

复用原 4 CPU/8 GiB Node SDK、UID 1000 与 Data 缓存，未安装依赖或构建镜像：

```sh
node --test --test-name-pattern="SERVICE|source bytes" \
  file-storage/adapter/test/query-revision.test.mjs
```

句柄 60125 实际 exit 0：115 passed / 0 failed。删除私有快照生产函数
`nativeFile` 的 SERVICE ACK 比较后，原断言实际 exit 1：缺失及错误 ACK
均出现 `200 !== 503`。已用补丁还原并与正式 cmp 0；句柄 36388 同命令
复验 exit 0，115 passed / 0 failed。原件位于
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/cells-onlyoffice-check.bCmhrJ/`：

- `cells-source-adapter-positive.log`：
  `0f347da22dcc5a0b9e8ca1ad2e43ee1192e4da6ac3364437eccdc4f4687beff0`。
- `cells-source-adapter-negative.log`：
  `355e59fd36e12000fa2290e8afb24098f739d8a0ebfb45c824739944079e5b44`。
- `cells-source-adapter-restored.log`：
  `fd36285cc69f0fd1d5d06ef568736c07d260085f50bb1f7dc816b99c4de0ccc2`。

首次误用 Core 检查快照时缺少 file-storage 路径，句柄 10632 exit 1，原输出
`Could not find 'file-storage/adapter/test/query-revision.test.mjs'`；该次未运行
验证，不计通过。已改用原 Cells Node SDK 的实际挂载。

Go 句柄 44877 已实际 exit 0，原命令为：

```sh
go test ./common/auth ./common/auth/protocol ./scheduler/jobs/grpc \
  ./gateway/data/gw ./gateway/data/hooks \
  -run "TestNativeSourceRead|TestNativeReadAuthority|TestNativeReadTaskRecordsActualStreamOnce|TestAuthorizeAction|TestAuthorizeOperation" \
  -count=1 -v
```

原 authority 28 场景、SOURCE 15 场景、protocol 18 场景通过；原 Task
在实际 Bolt 中执行 19 个主场景及空流内四个零值证据断言，覆盖 create-only、
重复 key 不重读、零字节、ACK 丢失和撤权。两条 gateway 包编译通过，
实际输出为 `[no test files]`，不能计为网关业务测试。原件
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/native-go-cache/cells-source-native-positive.log`
SHA-256 为 `679043f86ae5018e5db3ccd48d3d236777b6bd65878cc5001d0432c2edc533d2`。
该冻结快照尚含实现后取消的 `assetId` 兼容；最终五字段 authority 另用
`go test ./common/auth -run TestNativeSourceRead -count=1 -v` 验证，句柄
68314 exit 0，15 场景通过。仅在私有 SDK 把生产来源身份比较从必须等于
实例服务 UUID 破坏为非空，原断言句柄 44022 实际 exit 1：
`mapping-rule_test.go:370: SOURCE human-transport: <nil>`。没有修改断言来制造
失败。apply_patch 还原生产比较并与正式源码 cmp 0 后，句柄 91919 同命令
exit 0，15 场景通过。以上两个最终源码文件在原 SDK gofmt 后均与正式 cmp 0。
每轮复用原空闲 4 CPU/8 GiB SDK，最终检查前 host available 26–27 GiB、
memory PSI avg10=0；不并行另开 Go 检查。

同一 Go 原件目录内的最终日志：

- `cells-source-native-final-positive.log`：
  `0947a0f6401579029dafa88af52256b7b1f89c3c649fdcef5403d0b031838d26`。
- `cells-source-native-negative.log`：
  `e867d44a5e8f83ad7a97cc6eb293c3f549218277bf899e0bce3c4dc4cb391c43`。
- `cells-source-native-restored.log`：
  `e420b65a46c07b4dd09b168ef1be9ae3d5d6be20bf0ce81c756f2dd721472c81`。

SOURCE proof 到 NativeReadExecution 与原共享 Task 分别验收，未在此模拟
真实 SOURCE S3→WeKnora 全链。没有执行本批完整门禁、真实
Cells→WeKnora 导入、页面截图、构建发布或部署。SOURCE 已读但回执网络不明
时仍保留原 operation/原 Task 待对账，不声称本批闭合了全部故障恢复。

## 2026-10-10 原生 multipart 分片恢复与完成回执

本批是原上传/保存消费者的直接修复，不新建上传页面、对象存储或任务权威。
实现后的四步影响结论：

1. 权威为 `.design/18` 的 Cells 字节/版本权威、`.design/07` §5.2 的真实终态
   与 UNKNOWN 边界。固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `common/nodes/objects/mc/client.go::(*Client).ListObjectParts` 收到原 S3 分片
   后却遍历新建结果中的空 `ObjectParts`，使实际恢复列表丢失；同版本
   `common/nodes/core/handler-exec.go::(*Executor).MultipartComplete` 丢弃
   `CompleteMultipartUpload` 的 ETag，再把 HEAD 到的当前对象直接当作本次
   完成。两者都是上游已有生产调用，不是无消费者的扩展。
2. 影响沿原 data gateway `ListObjectParts` → Router/Executor → mc，以及
   Version handler 的 MultipartComplete → Executor → 原 S3 SDK 完成与 HEAD。
   分片结果原样保留数量、编号、ETag、大小、时间及分页元数据；不改变公共
   接口或数据格式。完成后只接受原非空 ACK ETag 和同 key、同 ETag、非负大小
   且无错误的 HEAD，不把另一对象写入 draft Version 回执。Web/Desktop/Mobile
   原客户端 API 与页面未改，不另造两套上传主体。
3. SDK 沿 `go.mod/go.sum` 锁定的 `github.com/minio/minio-go/v7 v7.0.99`。
   `api-put-object-multipart.go::(*Client).completeMultipartUpload` 与
   `utils.go::ToObjectInfo` 都调用其原 `trimEtag`，故消费该 SDK 值直接比较，
   不发明十六进制、MD5 或 multipart 后缀规则。相反，`core.go::Core.ListObjectParts`
   直接调用 `api-list.go::(*Client).listObjectPartsQuery` 的 XML 解码，原引号
   予以保留。没有权限放宽、重试或第二回执库，没有新契约字段、迁移或配置。
4. 空分片、零字节、分页、完成 ACK 缺失、HEAD/对象错误、不同 key/ETag 及
   未知大小均有确定消费；真实远端错误原样返回，缺证据返回原 native internal
   error，不声称副作用未发生。原 Version 上层收到错误不会写成功回执，沿原
   UNKNOWN 路径，不重放完成。相同 ETag 不是跨存储原子 CAS 或失联 writer
   已退休的证明，本批没有解除首次上传、write/delete/share、完整七键类别、
   release/binding 准入与发布门禁。

实现后在原 core 检查文件补齐完成回执 10 场景，并在 mc 包用固定原 SDK
真实 HTTP 编解码检查分片/空列表/拒绝三场景与带引号的完成/HEAD ETag。
原生 S3 响应来自本地 HTTP 夹具，不将其称为真实存储或三端 E2E。
复用原 `kailo-cells-native-check-lftow7`、UID 1000、4 CPU/8 GiB 与 Data
模块/构建缓存，GOPROXY=off；每轮先确认 SDK 空闲，host available 26–27 GiB。

```sh
go test ./common/nodes/core ./common/nodes/objects/mc -count=1 -v
```

首次句柄 88435 exit 1：core 检查通过，但 mc 新夹具 `time.Date` 少一个纳秒
实参，实际报 `not enough arguments in call to time.Date`；这是夹具编译错误，
不是生产负向。修正后句柄 19938 exit 0，两包全部通过。仅在私有快照去掉
生产 ETag 比较并恢复旧空列表映射，原断言句柄 68852 exit 1：
`handler-exec_test.go:76` 抓到 changed-object/missing-head-etag 被当作成功，
`client_test.go:61` 报 `original uploaded parts lost: []`。apply_patch 还原
两个生产文件并与正式 cmp 0 后，句柄 75275 同命令 exit 0，两包再次全部通过。
原 SDK gofmt 后四个文件无格式差异；未执行整库门禁、镜像构建、部署或页面验收。

原件目录：
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/native-go-cache/`。

| 日志 | SHA-256 |
| --- | --- |
| `cells-multipart-evidence-initial.log` | `65e1aeccfdd91a6cd010e7c51045bc9eca8b56412a0af5d8574934d32723f561` |
| `cells-multipart-evidence-positive.log` | `05a3fba5cf56a3c61eb135ed1672ec29f8544e7545b498e067bbc0b670d2776f` |
| `cells-multipart-evidence-negative.log` | `4d540ae43ccef42b71e75920a391ee766fa020f1ba296c65f636ef65f11d3e8d` |
| `cells-multipart-evidence-restored.log` | `05a3fba5cf56a3c61eb135ed1672ec29f8544e7545b498e067bbc0b670d2776f` |

## 2026-10-10 原生 draft multipart 续传路由

实现后的四步影响结论：

1. 权威仍为 `.design/18` 的原生字节/版本权威及 DD-71/93、原 draft owner
   可见性。固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `gateway/data/gw/gateway-pydio.go::pydioObjects.ListObjectParts` 调用原 Router，
   `common/nodes/version/handler-version.go::Handler` 却没有该 override，
   实际继承 `common/nodes/abstract/handler-abstract.go::Handler.MultipartListObjectParts`
   直接查询 live node。创建/写入已路由到 versions Location 时，恢复列表
   因而查询另一对象。本批新增的是这个原调用的缺失路由，不是另一 uploader。
2. 影响只在原 Version Handler：list/part/complete/abort 共用同一原缓存
   target+revision、Location 和 owner 校验；分页参数、上传 ID、分片响应
   不改。Complete 仍先为原 target 补原 datasource 元数据，再只替换 in
   branch；其他 branch 保留。旧 protoFromCache 已无生产调用，删除，原
   检查在 _test.go 内读取原 cache。没有公共字段、迁移、新缓存或页面变化。
3. 有任一原映射但残缺/损坏、Location 不一致、非 draft、无 VersionId 或
   其他 owner 均拒绝，不转去 live 节点继续执行；沿原 visibleRevision
   使用本机当前原生身份，没有新增平台权限权威。成功才清理原映射的上批
   语义不变，原生远端错误直接传递，不重放 completion、abort 或对象写入。
4. 两项缓存读取均未命中时保留原普通上传路径；原 cache.Get 只有 bool，
   此结果不证明远端没有 draft、writer 已退休、执行未发生或可重新派发。
   eviction、重启/缓存丢失和失联 writer 的完整终结仍是原发布门禁，不能
   用本批 cache helper 宣称持久恢复。非法缓存映射沿原 VersionNotFound
   拒绝，owner 拒绝沿 Forbidden，远端错误不转换成成功。Web/Desktop/Mobile
   原 UI/API 均未改，平台 S3 写准入、首次上传与七必选 release 门禁保持关闭。

代码完成后在原 handler-version_test.go 补 list/part/complete/abort 四个
实际消费者 × 14 个场景，包括固定 draft 位置、空列表、原错误、普通上传、
非 flat、owner、partial/corrupt 映射、版本不一致，以及其他 branch 保留。
原受限 `kailo-cells-native-check-lftow7` 为 4 CPU/8 GiB。原调用 69510
长时间处于 `Ds / flush_workqueue` 后实际退出 1：未投递原 Cells 测试状态
目录，包初始化报 `Could not create local data dir ... -/.config/pydio/cells`。
这不是断言通过，也没有新 SDK、并行替代检查或清缓存。

沿既有 `CELLS_WORKING_DIR=CELLS_DATA_DIR=/tmp/cells-version-task-key-check`
恢复原隔离测试环境，最终四个 Go 输入统一 gofmt 后，以原缓存/offline
入口运行 `go test ./common/nodes/version ./common/nodes/core -count=1 -v`，
退出 0：version 6 个顶层检查、core 3 个顶层检查，包括本批 56 个操作场景。
私有生产输入把 list 的 newTarget 改回原 live target 后，原检查真实退出 1，
三个 list 场景报告 `multipart operation lost its original draft route`。
没有改变断言来制造失败，正式生产字节未被破坏。

原件目录为 `/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/native-go-cache/`：

- 首次失败 `cells-draft-resume-positive.log`：SHA-256 `e9e42ffb1a11b9eaa47127ddd1702f41b922bf630904ef73c69609bda723b599`。
- 最终正向 `cells-draft-copy-final-positive.log`：SHA-256 `2074d921676cb57dc49f80634fedb9e3d1186c8e2b7d37468546abe9cb5b7b78`。
- 实际破坏 `cells-draft-copy-final-negative.log`：SHA-256 `5527a870c77869b1d4dcb55d4a2bbc65394cb176a6246b8e2f8311bdd01b9c7e`。
- 原字节还原 `cells-draft-copy-final-restored.log`：SHA-256 `530bf066928e97b18c7a36085f1455796762e48ece81f28104307871dca50920`。

另一包的分离反证实际退出 1 后，四个 Go 文件从正式源码恢复，逐文件 cmp
均退出 0，SDK gofmt -l 无输出。原两包再以 `-count=1 -v` 复验退出 0：
version 0.020s、core 0.018s，九个顶层检查全部通过。上述自有六路径
git diff --check 退出 0；没有触碰继承 compose 或其他业务改动。
不据此声明真实存储故障演练、完整首传、七项 release 门禁、部署或生产就绪。

## 2026-10-10 原版本保存清理的真实删除确认

四步影响结论：

1. 权威为 `.design/18` 的 Cells 字节/版本权威、`07` §2.4 的完整
   FILE_STORAGE 契约及 `03` 外部副作用 UNKNOWN 合同。已核固定 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `data/versions/action-version.go::VersionAction.Run`：原 StoreVersion
   返回 PruneVersions 后的 DeleteNode 只检查 error，没有消费其 Success。
   本批是原版本保存真实清理消费者的确认接缝，不是实现新的删除工具或权限。
2. 实际链为 `gateway/restv2/native-write-execution.go::Handler.executeNativePromote`
   → `VersionAction.PromoteRevision` → `VersionAction.run` → 原 StoreVersion
   → 原 `nodes.Client.DeleteNode`。同时普通原生 version event 也使用 run。
   删除返回 nil/Success=false 而无 transport error 原先会继续成功；现在只在
   全部原清理调用明确 ACK 后追加原成功 output 和 NativeVersionResult receipt。
   正常成功输出次序、原 Node/Version 身份、BranchInfo 和调用数量保持不变。
   没有改契约、数据库、Task 格式、平台状态、原页面或三端行为。
3. 远端错误原样返回；未确认 ACK 沿原 StatusConflict 返回。实际平台调用者
   遇此错误只回读/返回原 Task 非终态，不写 Finished/EndTime、不返回 SUCCEEDED，
   沿原超时/对账进入 UNKNOWN，不把已经发生的部分清理伪装失败回滚。
   本批没有再次调用 Promote、重复 DeleteNode、恢复已删字节或增加第二个清理器。
   缺终态仍由既有执行对账承担，不声明未知清理已自动恢复。
4. 无 PruneVersions 时原正常保存不增加调用；有多个旧版本时遇首个未知 ACK
   即停止后续删除，已确认的前序副作用保留。nil response、明确 false、
   transport error 和部分确认都不能留下这次保存的成功 receipt。
   UNKNOWN 不是新的业务失败枚举；既有 scope/身份/权限校验与 quota 不变。

`scheduler/jobs/native-write.go::NativeWriteRevision` 强制原 Task 为 Finished、
EndTime 为正且持有精确 task/action/node 派生 revision receipt；原
`scheduler/jobs/rest/native-write.go::nativeWriteObservation` 只消费它，不用 HeadVersion 存在
反推清理完成。当前没有仅凭已保存 Version 即能安全终结未知 prune 的原消费者；
原 observe/extract_usage 对缺证据继续非终态/拒绝，不能声称这类 UNKNOWN
已自动收敛。本缺口仍阻断 write 发布，不能通过改 Task 或重删来伪造终态。

实现后沿原 `TestVersionActionRequiresExactNativePersistence` 增加单个/多个完整 ACK、
nil ACK、false ACK、transport error、第二次清理未确认的六个实际消费者场景，
断言失败不含成功 ActionOutput、清理调用不越过未确认位置。原 draft cleanup
检查同批运行。原受限 Cells SDK 中 gofmt -d 无输出、exit 0，正式与私有两文件
cmp 一致。原进程 16647 正向 exit 0（0.020s）是多个 ACK 场景加入前的
中间快照，不作为最终验收。最终快照 99521 exit 0（0.023s）；私有副本
恢复原生产逻辑的“提前成功 output/receipt、DeleteNode 只检查 error”后，
62147 真实 exit 1（0.017s），missing-ack、rejected、transport-error、partial
四个子场景失败并报告 `unconfirmed native write produced a successful action output`。
完整 ACK 的单个/多个场景仍通过，未篡改断言制造失败。

随后从正式源码还原私有两文件、逐文件 cmp 一致，SDK gofmt -d 无输出。
最终顺序还原复验 79998 实际 exit 0（0.021s），三个顶层检查通过。
正向和还原命令为 `go test ./data/versions -run
'Test(VersionActionRequiresExactNativePersistence|NativeDraftUploadPrune)' -count=1 -v`；
反证使用同入口 `-run 'TestVersionActionRequiresExactNativePersistence/claimed-prune'`。
沿原 `kailo-cells-native-check-lftow7` SDK（Go 1.26.8，4 CPU/8 GiB、无额外 swap），
复用 `/cache/mod`、`/cache/build`，使用 `GOTOOLCHAIN=local`、`GOFLAGS=-mod=readonly`、
`GOPROXY=off`；原 `CELLS_WORKING_DIR`/`CELLS_DATA_DIR` 均为私有
`/tmp/cells-version-task-key-check`。没有并行替代进程、镜像构建或清缓存。

原件目录为 `/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/native-go-cache/`：

- 中间正向 `cells-version-prune-ack-positive.log`：SHA-256 `bf65d76293e0bd8c8423a38c89bbdd794c2381d4b2356d208d83f5bc726e825e`。
- 最终正向 `cells-version-prune-ack-final-positive.log`：SHA-256 `a183d22f4adb58faba08713c4580bb1bb5f1670219cd9f8371a7afa2937b22e6`。
- 生产反证 `cells-version-prune-ack-negative.log`：SHA-256 `c31e03cc7f976adc72b8b08da97ea3a4dfafb95580188b31c543d4aa01e7b8c0`。
- 原字节还原 `cells-version-prune-ack-restored.log`：SHA-256 `17f1e6bf6a33605268b55031041c46c03cb056d858eeb9d0250a0d662a53d669`。

原包检查日志中的 file/service logger 未注册警告保留；这不是生产审计投递验收。
本批未另起全局构建或文档检查，由主线集中收口，不能把窄验写成全量门禁通过。
本批没有部署、真实对象存储故障演练，也未解除首次上传、目标原子 CAS、
失联 writer 退休或 FILE_STORAGE 七必选批准门禁。

## 2026-10-10 冻结候选原构建与编辑器真实输入修正

沿 `apps/07` §2.1 和原 `tools/build-upstream.sh file-storage-service` 收口产物，
不部署或激活组件。原候选 tree `79f54effa177b87df71693a6bed4ed028f9b799e`
从 apps Git 对象导出，非当前 dirty 工作树拷贝；基底 commit 是
`f5673422728077dc24c694981e99d57e770b9ab1`，版本字段明确为该 commit 加
`-dirty`，不把候选 tree 冒充 commit。官方基准仍为
`c57f02f4962835447df694c63bd0fd8c22bd7baf`。

原构建 47317 实际退出 1。真实 `editor.libreoffice/res/js/editor.js` 消费
`../../../../../adapter/src/native-reference.mjs`，而原 frontend stage 仅复制
`frontend/assets/`，导致 webpack 报 `/src/adapter/src/native-reference.mjs`
不存在。该 helper 已在同候选源码及完整构建 context 中，且没有传递 import；
全 frontend 实际跨 adapter 引用仅此处。本次只补原 Dockerfile 的单行
`COPY adapter/src/native-reference.mjs /src/adapter/src/native-reference.mjs`，
放在原 apk/SHELL/ENV 之后、原 pnpm 构建 RUN 之前。页面、权限、原 helper、
依赖锁与各模块构建次序均不变；缺输入明确失败，不删除原编辑器以求通过。

初版 COPY 位于 apk 前，增量 SHA-256
`38245ee62057a429b7777f08dc13ca1ede25b0224e461c8cd8fa872bd0dd8bc4`；
随后只移动到依赖准备之后，保留可复用层，最终增量为
`cells-native-reference-copy-after-deps.patch`，SHA-256
`16d85e7ceb6115458601100a9894c2624e57db640acffe275852d21a71e89e44`。
主线私有候选已精确整合为 `d7f6cbe24daaef400aefef76e053d07d3edfed73`；
相关全部导出路径对该树的 `git diff --exit-code` 为 0。
原 helper 重算源码摘要从
`sha256:2d619edc5b8e583dc9d8141766ffa0f51f7f2df5047dfa78ecf5c1aa10c7fb68`
变为 `sha256:852312050fd17e6549faaaac1b0c2268cceb515179abd00b7e46832962af9892`。

原件目录：`/volumes/data/kailo/tmp/cells-knowledge-candidate-build-20261010.LL0KzU/`。
首次 `cells-candidate-build.log` SHA-256
`19d53393fd6ece5b006e37a33273237a626ec585a765bb539740ff50c0ca98ab`；
`build-file-storage-service.Op6Tj8.log` SHA-256
`16cad9286463a88688728bf44eaa848c043d930a284444c5aaf6c29041516ae2`。
原依赖 npm 输出 8 项漏洞（1 moderate、6 high、1 critical）原样保留；没有
执行 audit fix 或改锁。原 Webpack 部分模块通过不能代替整个镜像成功。

修正后原入口 83988 正在运行，尚无新 artifact 终态；记录时日志是
`cells-candidate-build-after-copy.log` 与 `build-file-storage-service.cjsS4Y.log`。
仍使用原 `kailo-core-data`、8 CPU/16 GiB/16 GiB、
`/volumes/data/kailo/buildkit-core-state`，没有清缓存或另起并行替代构建。
实际仍联网下载基础层和包，不能声称完全离线或全部缓存命中。

后续真实终态：83988 exit 1。唯一 COPY 修正已被原消费者验证：
`editor.libreoffice` webpack 成功，全部原 frontend stage 完成；原 Go
生产构建及 `/out/cells version` 成功，版本为 `5.0.3-dev`、Go `1.26.8`、
revision 为上述基底 commit 加 `-dirty`。OCI 导出和 Docker 导入完成，
随后原 helper 的 `REGISTRY` 必填校验失败，故该句柄不能记作完整成功。
实际配置字段为原 `deploy/local/.env` 的 `REGISTRY_HOST`，不是 `REGISTRY`。

恢复只执行同一 helper 的既有后半段：从该非密字段投递 `REGISTRY`，
核已导入的精确镜像，再原 `docker tag`、`push`、`inspect` 和
`upstream_manifest.py record`；没有再次构建。恢复句柄 3398 exit 0，
独立读回 snapshot manifest 与 Docker RepoDigests 一致。候选源码摘要为
`sha256:852312050fd17e6549faaaac1b0c2268cceb515179abd00b7e46832962af9892`，
registry artifact 为
`sha256:391b870038c2616ebc8c28ec38d841574838672245196727e61be6336722d20a`。
镜像地址为 `127.0.0.1:55000/file-storage-service:c57f02f49628`；
实际部署仍引用旧 digest，没有更换运行实例或激活 binding。

原件仍在本节目录：`cells-candidate-build-after-copy.log` SHA-256
`f265ba94571388cb65487c9bfaac571887011b7da88e2d2fbf897cd708c700a5`；
原 helper `build-file-storage-service.cjsS4Y.log` SHA-256
`2ee4d374e5ec7354194f8f344c3d1f486462d3279d68fcc71a12784203085629`；
恢复 `cells-candidate-registry-resume.log` SHA-256
`ea1d358506cf9fb118ed241e023068cf6edd6bd3d2501bbd89edb770d3a5f91f`。
原配方没有生成独立 SBOM/provenance 文件，不能冒称已经具备；候选来源由
基底 commit、精确候选树、源码摘要、锁定配方与上述实际日志共同记录。
本批不是 clean commit 正式发布，也不解除 FILE_STORAGE 七必选、首次上传、
目标 CAS、writer 退休及业务验收门禁。正式清洁提交后若要求 binary revision
改为该提交，应按最终来源重建所需层，不能把本候选直接称为正式发布。

### 2026-10-10 同批适配器产物回执

原 `tools/build-upstream.sh file-storage-adapter` 句柄 15854 完整退出 0；
沿上述同一冻结源码目录和受限 builder 构建、导入、推送并自动登记来源。
source 为 `sha256:c7c16cf2953fdbce87d4bf193a38eef9ee9218ff0298072b52bda079649bebc4`；
artifact 为 `sha256:705480fd0013e45912757ea38a39d113ee665b918f8198f3dbf1e888f7d26c01`。
独立按此 digest 从本地 registry 读取 OCI manifest，SHA-256 与登记逐字一致。
没有更换运行实例、投递 SecretRef 或激活组件 binding；本产物不是业务验收。

原构建日志为本节目录的 `build-file-storage-adapter.61FxlW.log`，SHA-256
`d45cecded58d9bf497d8720c05cdd8009317c08ed09d5164f5acb20a9bd61fa3`。
日志明确存在基础镜像下载与 npm 安装，不声称完全离线。后续删除版本的
独立开发输入不在此冻结产物及前述 native service 镜像内，不能挪用其验证结论。

### 2026-10-10 原生后台删除入口的准入边界

本批基准为 apps `68c08fd199779da2aba10b31b4c6d5e988aadf12`。固定上游
Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`gateway/restv2/api-actions.go::PerformAction/ControlBackgroundAction`、
`data/tree/rest/rest.go::DeleteNodes` 与
`scheduler/jobs/userspace/userspace.go::DeleteNodesTask` 已直接读回：前两条
删除入口均调用原 `DeleteNodesTask`；回收分支在 `PutJob` 以前写入
`recycle_restore` 元数据并可能创建回收目录；后台控制入口可直接向原 Task
派发控制。既有 `DeleteVersion` 拒绝未准入写入不能覆盖这些入口。

1. 权威：`.design/07` §2.4 的 FILE_STORAGE 七必选与 `delete` permission、
   DD-87/88 及工程规则 9/10；身份、原生 ACL 或 SSO 不能代替 Action Admission。
   本批修复既有原生 HTTP 消费者的绕行，不登记或启用尚未闭合的 delete 能力。
2. 影响面：原 `AuthorizeNativeDataMutation` 统一消费并拒绝未支持的写入
   proof，覆盖 PATCH；v2 动作、控制及 v1 删除在读 body、读节点、写回收元数据、
   创建 Job 或控制 Task 之前调用该守卫。`DeleteVersion` 删除重复 proof 包装，
   使用同一消费者。GET/HEAD 不剥离 proof，保留原读取链；未投递 platform 且
   无 proof 的独立服务仍走原实现。没有 schema、数据库、原生 Task 或四侧生成变化。
3. 副作用：空 platform 对象同样拒绝，伪造、空值或重复 proof 不能退回独立
   模式。拒绝发生在第一次副作用之前，属于 DENIED；不会新建 AE/Task、产生
   零用量回执、自动重放或把既有 UNKNOWN 改成终态。原先已派发任务不在本批
   收敛范围；未修改 Task 存储、后台观察或组件停用排空。
4. 边界：拒绝路径不消费业务正文或原生节点，保留读 proof、独立原生输入校验
   与已有删除版本完整 ACK 消费者。原 API、页面及独立运行功能未删除；受管
   操作尚无合法准入实现时拒绝，不以入口拒绝声称完整删除已交付。

`PerformAction` 的实际六个封闭枚举为 delete、restore、copy、move、extract、
compress，本批覆盖它们的受管直达调用，不只删除。现有 node 读取、version
写入分别经原 lookup/node/version 与 PromoteVersion 消费者；它们没有调用此
后台动作入口。`ControlBackgroundAction` 拒绝受管 None/Pause/Resume/Stop/
Delete/RunOnce/Inactive/Active；现 adapter 的 node/version 取消能力固定为
UNSUPPORTED，DOCUMENT 取消经 `auth/token/document/{session}/{node}` 撤销 PAT，
不经过这个 Task 控制入口。本批未更改这些观察、取消或停用消费者。原 UI 的
JobsStore/AdminScheduler 使用另一路 `UserControlJob`，不在本批覆盖范围；
不能声称所有原生后台控制均已完成平台接入。

`contracts/adapter/file_storage.v1/` 当前没有 `delete_input` / `delete_output`，
这是已有必选能力的实施缺口，不是 `.design` 禁止该能力。固定上游
`frontend/assets/access.gateway/res/js/callback/deleteAction.js` 保留原确认框，
按配置显示永久删除勾选并传 `RemovePermanently`；`emptyRecycle.js` 传回收站
路径，由 `DeleteNodesTask` 的 `SourceInRecycle` 选择永久删除。后续应保留
原请求两种语义与原 Task，不自行抹掉其中一种；目前随机 AutoStart/AutoClean
Job 还不能当作已关联的 ExternalExecution。完整 delete@v1、七必选批准及
原 UNKNOWN 终结仍未验收。

本批源码与原始检查目录为 Data 的
`codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-action-guard.OiDcbV/`。
原 SDK 已回读 4 CPU、8 GiB memory、8 GiB memory+swap 与 user `1000:1000`，
源码、TMPDIR、模块和构建缓存均位于 Data。冻结六个 Go 文件的 `gofmt -d`
已退出 0 且无输出。第一次原 restv2 单包检查的 `positive.log` 明确失败：
`Could not create local data dir ... -/.config/pydio/cells`，随后为包 `FAIL`；
中断后原 wrapper 句柄不可恢复，没有伪报该句柄退出码。实际 SDK 只剩
`sleep infinity`，确认原 Go 已结束后，才沿原 `ApplicationWorkingDir` 消费
的 `CELLS_WORKING_DIR` / `CELLS_DATA_DIR` 投递同一 Data 快照的
`native-state`，不修改 HOME、不转移 TMPDIR、不改产品源码迁就环境。
修正投递后使用原 `go test -mod=readonly ./gateway/restv2 -run
'^(TestNativeBackgroundActionsRequireAdmission|TestNativeMutationGuardPreservesReadProof|TestNativeBoundDataGatewayDoesNotBypassPromote|TestDeleteVersionRequiresEveryNativeAcknowledgement)$'
-count=1 -v`；原 SDK 工作目录是该快照的 `file-storage`，`GOPROXY=off`、
`GOSUMDB=off`，没有下载依赖。句柄 96060 实际退出 0（包 2.940s），
覆盖六动作、控制、v1 删除的 48 个入口/配置场景、12 个读 proof 场景及
原 S3/版本 ACK 边界；日志共 142 条含父测试的 PASS，不称 142 项业务联调。

实现后只在私有快照真实删除三处生产入口守卫及不再使用的 import，保留测试；
同包 `-run '^TestNativeBackgroundActionsRequireAdmission$'` 的句柄 15051
退出 1：40 个 bound/proof 场景 FAIL，8 个独立输入校验场景仍 PASS。
随后两生产文件按正式原字节恢复并 `cmp` 一致，重跑原四目标，句柄 37517
退出 0（包 2.937s）；最终六文件 `gofmt -d` 退出 0 且无 diff。
原错误、正向、生产反证、还原日志依次为该目录的：

- `positive.log`，SHA-256 `212333b50b12366df70912adc4862c7f4138ff407df303a205dd5cda7c72612e`；
- `positive-delivered.log`，`34218b0b21c444d6c39ec4f584bbe5432b45b93ba878bbc373dc497822c1cbb5`；
- `negative-guards.log`，`688536d4ed2db0e981fbc391828401dff73f737787c321650cee96f57a54409a`；
- `restored-final.log`，`38b55953ff45cfcc0e77b402f5e16701513e574d3bad0af59b570453b2719b9a`。

相对本节基准的六代码路径为 +146/-14（含新 `api-actions_test.go`）；
精确 `source-final-six.patch` 的 SHA-256 是
`5f82bf961cdd04c04a166c51281f46999a367a859bcf0cf81b4bb434595e3946`。
本批没有启动新镜像或 full、部署或激活绑定；提交由主线程集中处理。
这些检查证明绕行被拒绝，不证明完整 delete/share、原生后台控制治理、
三用户业务交互、FILE_STORAGE release 七必选或 UNKNOWN 对账门禁已闭合。

### 2026-10-10 原删除/回收 HUMAN—adapter—原 Task 消费接线

本批沿固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf`，
`frontend/assets/access.gateway/res/js/callback/deleteAction.js`、`emptyRecycle.js`
与 `scheduler/jobs/userspace/userspace.go::DeleteNodesTask` 的原删除/回收语义。
保留确认框、永久删除选择、回收站规则与原 tree delete/copymove 执行器；
不以复制上游或该源码检查点声明七必选批准或部署完成。

四步影响结论如下：

1. 权威为 `.design/03` §6 的 HUMAN APPLICATION、ADR-12 §7 原
   `{target,input}` 及 `.design/18` 原写动作接缝。本批补充既有 delete 能力
   输入 schema（resourceId、所选 UUID、removePermanently），不把原生控制参数
   伪装成有正文 revision 的 ContentReference。Core 通用 `inputJson` 接受
   能力 schema 验证的 UUID/布尔/整数控制对象，保持旧 ContentReference 分支；
   不允许 SQL、prompt、正文或任意字符串写入 AE/Temporal。四侧与 Core
   验证由主线程集中收口，不以 Cells 检查替代。
2. 原 UI `/tree/stats` 经本人原 ACL 读取后取得投递的非秘密 binding/generation；
   `/tree/delete` 先观察相同 HUMAN key，再 resolve 当前原 Resource、核原 UUID
   与作用域后提交。多选不能创造共同 Resource；不存在真实已注册 root 即拒绝。
   adapter 原 HTTP/MCP 复用同一 executeDelete，受控 jobID/COUNT 用量配置没有
   默认值。后台先以原 DAO ClaimTask 持久化 coordinator，原 ActionOutput
   冻结 child Job 定义与确定性 child TaskID；Task ID 全局唯一，child 使用
   自身 Job ID，不能复用 coordinator key。原 ClaimJob 与 bolt/mongo PutJob
   拒绝覆盖或移除受管标记，原 Queue 只接受冻结原 Job 的 RunTaskId。
3. 真实副作用仍在 `DeleteAction.Run` / `CopyMoveAction.Run`；持久化每个所选
   UUID 的原 ActionOutput ACK，观察器同时核原 Finished、EndTime、owner、
   Job digest、selector、所有节点 ACK 与回收目标，不靠空 selector/节点消失
   判成功。共用 `common/nodes/copy-move.go::CopyMoveNodes` 还被
   `common/nodes/sync/handler-sync-folder-tasks.go` 与
   `scheduler/actions/idm/clean-user-data.go` 消费；本批传播递归 403/流错误、
   真实 UpdateNode/DeleteNode ACK，并删除 source 删除结果不明后删除 target
   的危险补偿。固定 `common/nodes/core/handler-exec-struct.go::CreateNode` 与
   `handler-exec-flat.go::CreateNode` 以 Node 返回成功、Success 默认 false，
   因此只校原 UUID/路径，不误拒合法原版回复；MetaServer.CreateNode 及
   TreeServer.UpdateNode/DeleteNode 的 Success 则由原生产者实际设置。
4. 浏览器 localStorage 仅保存无秘密的原请求 key/所选 UUID 与身份、仓库、
   tenant/binding/generation 域；存储失败在派发前拒绝。刷新后观察同 key，
   已不存在路径不重新提交新操作；换代保留旧 UNKNOWN，不清 key 重发。
   202 不清选择，只有 Core 确认 COMPLETED 或原 FAILED/CANCELED 终态才
   退休该请求。Task 部分 ACK、未知回复、已发副作用后断连均 UNKNOWN；
   空输入/重复 UUID/错资源/未知字段先拒绝。鉴权拒绝沿既有 FORBIDDEN；
   原请求/证据冲突沿 CONFLICT/INVALID_ARGUMENT；派发及终态不明保留
   UNKNOWN，不将超时映射成已失败或零用量成功。

新增 `delete.bindingGeneration` 是既有受控配置投递的运行期非秘密字段，
只用于 UI 意图域，不是服务端授权。真实 binding/generation、身份、scope、
quota、审批与审计仍由原 Core/PEP 执行，不开放任意原生后台动作。

原 Go SDK `kailo-cells-native-check-lftow7` 复核 4 CPU、8 GiB memory/swap，
模块、构建缓存、TMPDIR 与 CELLS_WORKING_DIR 仍在 Data；未新建镜像。
原 compile-only 73849 退出 0，仅证明此前快照编译，不是最终业务验收。
最终快照定向命令为 `go test -count=1 -run
'TestNativeDelete|TestDeleteAction|TestTask|TestReadNative|TestPutTask|TestClaim|TestNativeActor'
./common/auth ./common/nodes ./scheduler/jobs/... ./scheduler/tasks
./scheduler/actions/tree ./gateway/restv2 ./data/tree/rest`，句柄 20673 退出 0；
grpc 39.214s、tasks 0.017s、tree 0.016s、gateway 0.011s。其他包明确
`[no tests to run]` / `[no test files]`，不称已执行；Mongo 仅编译，未做真实 Mongo
数据库演练。原日志位于
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-delete-governed.WFcXfh/`。

实现后在 SDK 私有生产 `NativeDeleteTerminal` 中实际去掉所选 UUID ACK
完整性约束，原 `TestNativeDeleteTerminalRequiresOriginalPerNodeAcknowledgements`
立即抓住 missing-ack 与 partial-ack 被错误结成 terminalAt=123，句柄 7558
退出 1（grpc 34.974s）。随后恢复该文件原字节，原整组定向命令句柄
44493 退出 0（grpc 7.752s、tasks 0.017s、tree 0.015s、gateway 0.011s）。
上述 Go 目录内原日志及 SHA-256 为：

- `compile.log`：`2b425ddf137100ba81bd027154d1fb6883668fcc5dd01c4a70882ada1a3b10cf`；
- `positive-final.log`：`12c8a4c24fea7f35e64d85ab664f260096aeeeb5d426d482f453b2e1864b4a74`；
- `negative-acks.log`：`2598d701a1a7624f94079ce1135bd3b0fe048b18aa9eda35d3aca0617bd37efc`；
- `restored-final.log`：`4663815d009870859386d9e8245d3b40f81f088417393bfac50854fab0e9015e`。

Mongo 并发清理边界另外核对实际源码：DeleteJob 的前置 Count 不是保护依据，
真正 DeleteMany 保留原 `claimMarkerPath:{$ne:"true"}` 条件；即使其间新增
ClaimTask，该 claim 也不能被删。最后 DeleteOne 同时排除两个受管 metadata
标记，原 PutTask 的日志 CAS 与 ValidateTaskUpdate 禁止移除第 0 个 claim。
`go.mod` 固定 mongo-driver v1.17.9 的 DefaultStructTagParser 默认将字段名
转小写；mongoTask 的匿名 Task 未标 inline，protobuf 结构没有 bson tag，
原 mongodb 连接也未启用 JSON tag fallback，故原
`task.actionslogs.0.inputmessage.outputchain.0.vars.X-Pydio-Task-Create-Only`
路径与实际默认编码一致。这是源码核对，未冒充真实 Mongo 并发实测。

Node SDK `kailo-cells-onlyoffice-node-bcmhrj` 同为 4 CPU/8 GiB，原空闲进程
仅 sleep。首次 72522 退出 1：复用 setup 会同时登记原检查，但窄快照缺原 UI
文件且旧 node_modules 无 MCP SDK；原失败日志保留，未计通过。随后原锁
`npm ci --offline --ignore-scripts --no-audit --no-fund` 退出 0，复用 Data 缓存
安装 97 项，无新版本、无联网安装。最终只选择本批 9 个父场景与其子场景，
`node --test --test-name-pattern='governed native deletion|delete observation|native delete uses|delete refuses|original delete retains|a pending old|unreadable or unwritable|pending observation|only original Core'
file-storage/adapter/test/native-delete.test.mjs` 正向及还原均 32/32、退出 0。
真实删除 adapter `execution.idempotencyKey` 比较后，wrong-key 返回 200 被
检查抓住，反证退出 1；真实改为忽略已有浏览器意图后 4 场景失败、退出 1。
两个生产文件按私有正式字节还原后复验，不以模拟响应的拒绝当生产反证。
Node 原日志目录为
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/cells-onlyoffice-check.bCmhrJ/delete-governed.hb2FHx/`：

- `adapter-positive.log`（首次失败）：`9d8092723cbf5fb92df4c630df78bd9af0675edf3886f5fcee9229d9f097d400`；
- `adapter-positive-final.log`：`b4e676d480aed76e658e001b76546bc5853d564b9c809ec4eab7697f8a746429`；
- `adapter-negative-key.log`：`a4800e316f83faf5489a19d51cccf16a31c4d0ab0436e4c23ffa5fab196cd95a`；
- `adapter-negative-intent.log`：`2fd6d533d58195532237ac12d5261da52b94a3c062f8dd3a72fd2770a37b7613`；
- `adapter-restored.log`：`954852bbf50e85754aef6bce0240d4c887457b28e7f7838a5b22574bcaf32c44`。

发布阻断仍明确存在：fresh PEP 已覆盖 coordinator 持久化、首次原生 metadata、
PutJob、broker 派发及响应边界，但异步 child `scheduler/tasks/task.go::Queue`
只检查原已冻结准入与 create-only claim，之后 `DeleteAction.Run` /
`CopyMoveAction.Run` 仍沿 native ACL，不等于延迟执行前再次向平台在线复核
撤权。部分副作用后无 ACK 的 UNKNOWN 没有凭空产生补偿/重放/零用量终态。
因此本批不激活 release/binding，不宣称 delete 全治理、七必选、目标 CAS、
三用户真实端到端或 Cells→WeKnora 已验收；原 UI 视觉截图和实际绑定审批
运行未执行。本节只计源码接线及上述受限消费者证据，后续沿已有 PEP/绑定
链闭合延迟执行门禁，不新建执行或终态权威。

### 原删除完整 ACK 与末尾派发标记丢失的收敛

- 权威与原逻辑：`.design/03` §6、`.design/06` §5.1 和 ADR-12 §8 允许按原
  ExternalExecution 的真实 native 事实观察终态，不重放。固定 Cells
  `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
  `scheduler/jobs/userspace/userspace.go::DeleteNodesTask` 在返回前提交原生子任务；
  当前治理 producer `userspace/native-delete.go::DeleteNodesGoverned` 最后只写
  `nativeDeleteDispatchComplete`。进程在最后子任务提交后、这个标记落盘前崩溃，
  已有所有节点终态 ACK 仍被 `NativeDeleteTerminal` 拒绝，是本次修正对象。
- 影响面：只改变 `scheduler/jobs/native-delete.go::NativeDeleteTerminal` 的末尾
  派发标记必填条件。实际消费者仍是 `scheduler/jobs/rest/native-delete.go::nativeDeleteObservation`；
  原 binding/actor/operation 匹配、observe/extract_usage PEP、响应前 fresh PEP 都不变。
  无字段、schema、数据库迁移或新状态；旧带标记记录与缺标记记录沿同一原生证据读取。
- 副作用：不派发新任务、不补写伪 ACK。必须读取每个冻结 child Job 的精确 digest、
  owner、selector、create-only claim、Finished/EndTime 及逐项 mutation ACK，所选 UUID
  全覆盖且无重复才将原 coordinator 持久化为 Finished；这份观察 ACK 未确认仍不返回终态。
  标记存在但失败或重复仍拒绝。marker 不是副作用成功证据，也不替代任何节点 ACK。
- 边界：永久删除与回收使用同一规则；缺 child、部分 ACK、未覆盖 UUID、空 selector、
  错 action/节点/回收目标/digest 或查询/落盘响应不明均保持 UNKNOWN（`06` §4），
  不将缺失解释为零用量或可重试删除。存储不可达继续原查询，完整肯定证据到齐后原
  observe 收敛；没有证据不设猜测终态时限，也不声明部分副作用 UNKNOWN 已全部解决。

延迟 child 副作用前平台 fresh 授权仍是发布阻断。本次核对 `.design/03:718`、
`.design/10` §1/§4、ADR-12 §8 与 `action_token.rs::issue_component_action` /
`application_action.rs::advance_inner`：现 execute 只由原首次派发签票，EE 已存在时
只走 reconcile；系统观察令牌不能续 execute。Adapter Protocol v1 `pep_check`
要求完整未过期 ActionToken，尚无 binding SERVICE 按原 EE 取得延迟执行授权的
实际消费者。本次未将票据写入持久 broker、未借用 SOURCE/PROTOCOL/observe 授权、
未增加协议或延长业务票据，也未激活 release/binding。

本增量取得以下实现后正向、真实生产反证与还原窄验：原 4 CPU / 8 GiB SDK
`kailo-cells-native-check-lftow7` 已沿 Data 上的 Go 缓存与临时目录启动
`go test -count=1 -v -run '^TestNativeDeleteTerminalRequiresOriginalPerNodeAcknowledgements$' ./scheduler/jobs/grpc`，
句柄 `45329` 已实际退出 0，16 个场景及原 BoltDB DAO/gRPC 目标通过，
包耗时 78.962s；`gofmt -d` 未输出差异。窄验日志在
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-delete-governed.WFcXfh/terminal-positive.log`。
日志 SHA-256 为 `8e413cd0183c02c35066661683f7bd511f8ecceee6a16a9718582428e77c14ce`。
仅在 SDK 私有生产副本恢复旧 `!complete` 条件，原目标反证句柄 `56416`
实际退出 1，包耗时 94.511s：`missing-dispatch-ack` 与
`recycle-missing-dispatch-ack` 两场景报
`actual complete ACKs not accepted: 0 conflict`，其余 14 场景通过，
不是编译失败。还原该生产行后，两份 Go 文件与正式源码分别 `cmp` 退出 0；
同一原目标还原句柄 `21275` 实际退出 0，16 场景全通过，包耗时 349.062s。
原正向/反证/还原均使用原 BoltDB DAO 与 gRPC 消费者，未以 Mongo mock
冒充 Mongo 实例验收，未新增或重启 SDK，未清缓存。

同一日志目录另两份原件为：

| 日志 | SHA-256 | 退出码 |
| --- | --- | --- |
| `terminal-negative.log` | `51889f44526e31d1a8efc2f81e3a3bce7c62ebdd61257391cc8035ce1821271d` | 1，预期反证 |
| `terminal-restored.log` | `f2fb3436f77de618262dadb71c758b74d8cb24113230b28e71680beb9f000851` | 0 |

本增量的全量检查、真实 Mongo、实际 binding 与 UI 操作验收未执行；不将这
16 场景称为删除完整治理、Cells 七必选批准或真实跨服务业务验收。

2026-10-11 阶段收口以 `4bc73369666644a05bf79369922d8b7ebc54c199` 为基线，
仅提取本节、上述生产函数及对应原测试；两份 Go 候选与已验证 SDK 输入逐字节
`cmp` 均退出 0，三份日志 SHA-256 与本节一致。排除同文件 NativeCell 新增测试，
不纳入尚未闭合的分享/绑定停用代码；复用上述窄验，未重新构建或部署。

## 2026-10-10 原 PutCell 的 HUMAN 只读成员增删消费者（源码候选）

本批直接接原 `CellModel.save → PUT /share/cell → Client.UpsertCell`，保留原
分享弹窗、布局与独立原生安装路径；只接已有 Cell 的 HUMAN 只读成员整项增删。
这不是完整 `file_storage.share@v1`：创建、roots/标签修改、WRITE、群组、到期及
分享链接仍未闭合；受管入口拒绝未支持模式，不能据本刀注册六键子集或激活整个
FILE_STORAGE release/binding。平台 READ 授权成功不等于 Cells 多 RPC 已完成。

四步影响说明：

1. 权威：`.design/03` 原平台 `resource.grant_read/revoke_read`、`.design/07`
   七必选与 `.design/18` 身份/原生接缝，复用当前 Core NativeHumanAction 可信
   `nativeHumanOrigin` 消费者，不把平台权限动作伪装成 component execution。
   固定官方 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf`：
   `idm/share/rest/handler.go::PutCell`、`idm/share/client.go::UpsertCell`、
   `idm/share/client-acls.go::ComputeTargetAcls/UpdatePoliciesFromAcls` 为原调用链。
2. 影响面：原 `NativeActorDelivery.Actors` 同一受控映射反查 HUMAN principal，
   唯一、非 SERVICE、非群组且全部条目有效才接受；原真实用户查询及 Core 同
   Tenant/active 检查仍执行。配置 `cellShare` 显式投递 binding generation、
   原 Task job ID、native type 与两原权限动作版本，无默认身份或 generation。
   `authorizeScope` 复用既有合同，写前逐次核 exact tenant/binding/generation/
   native refs、permission 与非空 checkedRevision；原权限 AE 则逐项重新观察。
   原 REST GetCell 只在本人已有原生读取准入之后返回非秘密意图隔离元数据。
3. 副作用：先用原 Job/Task create-only 保存选择、精确平台命令与第二 Task ID，
   才调用权限动作；相同 UI key 只重放同一不可变平台命令，不换 principal/key。
   全部权限 outcome 已确认后，第二原 Task create-only 和 Running ACK 均确认
   才调用原 UpsertCell。原 Job 无 actions/events/schedule，不承担另一个执行器。
   原 Bolt/Mongo ClaimJob、PutJob/DeleteJob 保护及 Task 不可变 evidence 规则一并
   覆盖新用途。每个原 ACL/Workspace 写入前都有同一 request-local fresh 检查；
   丢失上下文或运行期撤掉配置不能回退独立模式。实际 native diff 必须与冻结
   root/HUMAN/READ 增删集合完全相同，不经继承策略或新建 root 偷做额外写入。
4. 异常：DeleteACL 要求真实 RowsDeleted；CreateACL 要求 exact ACL ACK；
   CreateWorkspace 要求完整 workspace/policy ACK。固定上游
   `idm/workspace/dao/sql/sql.go::Add` 会设置 LastUpdated，
   `common/storage/sql/resources/gorm.go::AddPolicies` 会重新分配政策行 ID；
   只归一化这两个服务端字段，LastUpdated 必须为正，政策正文不得缺失。
   只有全部原 RPC/原 reload 成功才持久化原 Task Finished + intent digest ACK；
   PutTask ACK 不明不向 UI 返回完成。读回已有 execution Task 永远不再 Upsert。
   已确认 execution 的 coordinator 终态 ACK 丢失可沿同 key 查询并重存相同
   终态；没有完整原 Task 回执不以对象存在、目标 ACL 看似一致推断成功。

UI 在原 localStorage 只存无秘密选择/key/binding domain；JSON 损坏或存储不可写
在派发前拒绝。浏览器重开复用原 key；旧 generation/选择不一致保留 UNKNOWN，
不删除旧意图并生成新 key。202 不清选择、不让 CompositeModel 将 pending 计成
成功；登录对象/本人 ID/repository 改变后旧 await 不再派发或消费新身份响应。
独立安装没有 domain 仍使用原 API；原视图不会因缺少尚未投递的 share 配置消失。

本刀尚不解决多平台权限 AE 的部分成功、本地多 RPC 后崩溃且未写 terminal ACK、
并发修改 workspace 缺原子 CAS，以及平台权限 AE 完成后 native Task 的完整
binding 排空关联。此类请求保留同一原 Task/意图，按 UNKNOWN 对账，不自动重写
ACL、补造成功、补造失败或释放意图；没有肯定证据的人工终结消费者仍不足，
因此此候选不能开放受管分享或解除原 release 门禁。其余原分享功能仍是交付缺项。

兼容与验收边界：新增 `cellShare` 是原受控 native 配置的实际消费者，不是新的
平台实体/合同。旧 binary 不识别该守卫与冻结 Job 标识；新配置不得投递给旧
writer，启用前需同批替换原 Core 可信来源及 Cells 消费者并验证实际运行版本。
此时仅私有源码写入，原 SDK `kailo-cells-native-check-lftow7` 回读为 UID
1000:1000、4 CPU / 8 GiB memory+swap、Data 缓存，原 gofmt 句柄 89661 退出 0。
新增原 auth/jobs/share 与原 UI save 消费者检查尚未执行；没有把原 full 或其他
组件验证称为本候选通过。真实 SQL AddPolicies 返回、Mongo、完整原 REST/SSO、
真实 Core grant/revoke、故障恢复与界面截图亦未验收；未构建、未部署、未激活。

随后取得本批 UI 原消费者证据：复用已空闲的
`kailo-agent-receipt-xvkujx`，回读 UID 1000:1000、4 CPU、8 GiB memory+swap，
只在独立 Data 目录执行 `node --test adapter/test/native-cell.test.mjs`。
首次退出 1（9/10）：检查夹具用 `Map.get` 将缺失响应头返回为 undefined，
而实际 Fetch Headers.get 返回 null；只纠正这一夹具返回，不更改生产拒绝边界。
最终正向退出 0（10/10）；在 SDK 私有 `nativeCell.js` 中实际删除
`attempt.domain !== domain` 拒绝行，原 generation 与 missing-domain 场景报错，
反证退出 1。还原后与候选生产源码 `cmp` 退出 0，同一检查再次退出 0（10/10）。
此处是实际 save helper 的 VM 请求/存储消费者检查，不是浏览器截图、原 Cells
后端或真实 Core 权限联调。完成后容器 top 仅 sleep，已交还原 UI 队友。

原日志根为
`/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/native-cell-ui.naLFgK`：

| 原件 | SHA-256 | 实际结果 |
| --- | --- | --- |
| `positive.log` | `58f6c1161c9544815c073a1eabf4228d7fbead46ebcce3d52c932e9195454ff2` | exit 1，夹具缺失头语义错误 |
| `positive-final.log` | `7c80a430f177e827665e8e961a3672bc9a2fa370dec20655842927c827e2f6c8` | exit 0，10/10 |
| `negative.log` | `92747b7d1f3c455b897b82c883fdafdcd0b40390c8d128823fc2eba40c6000be` | exit 1，真实生产反证 |
| `restored.log` | `da531a744e3199c17c5825f3dac99f4b8238e1944e21e0087f7bb42ae9b8e0db` | exit 0，10/10 |

Go 原 SDK 单任务 73306 已启动，原目标为 `go test -count=1 -v -run
'^TestNativeCell' ./common/auth ./scheduler/jobs ./idm/share ./idm/share/rest
./scheduler/jobs/grpc ./scheduler/jobs/dao/bolt ./scheduler/jobs/dao/mongo`；
此段记录时尚无终态，不据此填通过。镜像内 input/TMPDIR 都在 Data 私有目录，
未启动第二份 Go 或全量作业，也未改 Cargo 并行度。

### 本批 Go 最终正向、生产反证和还原

原 73306 已实际退出 1：auth/jobs/share/rest/grpc 的原生初始化均因本次调用
漏投递 `CELLS_WORKING_DIR` 报 `Could not create local data dir ...
-/.config/pydio/cells`；没有进入用例。只补齐已有 runtime/dirs.go 消费的该
环境项，明确指向本次 Data 私有 `.cells-runtime`，没有更改 HOME 或产品默认值。
各次 TMPDIR 也保持同 Data 私有目录。原失败日志原样保留。

冻结后发现并修正一处真实原版差异：固定
`c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`idm/share/client-acls.go::AclsToCellAcls/LoadCellAclsObjects` 读取已有用户时
不设置 `IsUserRole`（原 UI 添加成员才设置该提示位）。后端不再要求这个 UI 位，
仍要求真实 User UUID、无 Group/Role、非群组和仅 READ，后续原 User 查询、
受控 Actors 反查及 Core active/同 Tenant 准入全部保留。事后检查真正调用原
两函数及原 Role/User RPC 消费者；恢复旧提示位要求时该检查真实失败。

同一受限 SDK 的最终命令沿前述七目标，另加原
`./common/storage/sql/resources`，仍使用 `go test -count=1 -v -run
'^TestNativeCell'`。仅私有既有 `dao_test.go` 追加 TemplateSQL 后验：实际
SQLite `AddPolicies` 新增/更新返回与 `GetPoliciesForResource` 的持久行、
ID 及政策正文均一致，且强制实际执行计数为 1；没有 MySQL/PG 投递，也没有
早退被记通过。因此此前 AddPolicies 返回值疑点已排除，生产 DAO 未修改，
没有放宽空 ACK。该私有后验文件 SHA-256 为
`4e0b6e3d9f294956c1ba0b4753df0fd1cf93577208180f8c0f40a3e609f2c8c3`，
不进入交付源码。

正向 81798 实际退出 0：7 个顶层检查、30 个子场景通过。随后仅在 SDK 私有
三份生产源中破坏 HUMAN 映射完整性检查、原 Task share receipt 不可变检查、
binding generation 检查和负 ACK 判定，并恢复旧 IsUserRole 要求；37939
实际退出 1，五个顶层检查真实失败（包括八个失败子场景及一个原 ACL 对象
读取场景），不是编译错误。全部三份生产源用 apply_patch 还原，候选中所有
Go 源与 SDK 输入逐一 `cmp` 退出 0，再运行同一完整窄命令，24582 实际退出 0，
7 顶层/30 子场景再次通过。未用旧 binary 冒充本次命令，也未更改正式源作反证。

原件目录：
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-cell-share.Itii5l`。

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `positive.log` | `caeac78b06a4eb537a2c02df85b7d423f7dd7efc7f8216ca49b07b6e394aff92` | 73306 exit 1，原生工作目录未投递 |
| `positive-final.log` | `8d1d5c351b8efec882fa94958a15370278cb43bcb0ff5700ef6ba1c9f49bf4a2` | 81798 exit 0 |
| `negative.log` | `fdc336d3a5114504f7c1700945a1173de63dd57c1f3c9558d16b5d761415239e` | 37939 exit 1，生产反证 |
| `restored.log` | `7d961d30cc7268697050d2b39c832e5acff73eee2f80c6120185804f2bb22a2b` | 24582 exit 0 |

rest/grpc 目标仅编译且报告 no tests；Bolt/Mongo 目标 no test files，不记为
真实 Task DAO 持久化或 Mongo 实例验收。上述消费者检查也不等于原 REST 完整
PutCell/SSO/UI 截图验收。原 Task 在多 RPC 部分成功、崩溃和 binding 排空的
剩余缺口保持；未构建或激活组件。实际正向接入仍必须有已批准的七键 release、
真实 binding/generation、同一受控 Actors 的调用人和收件人、原已有 Cell 及
各 root 的 Resource 归属/版本，以及明确投递的 cellShare 元数据；已有三用户
SSO 不证明这些批准事实存在，不能直接补库、复制身份或伪造 ACTIVE 来过门禁。

### 2026-10-10 原分享 Task 绑定排空与原子 Claim 栅栏（源码批）

本批依据 `.design/07` §5.2、§6.2 的既有 binding reconcile/停用语义，
以及固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`scheduler/jobs/rest/handler.go::UserListJobs`、原 Job.Inactive/Task 存储消费者。
前批 readonly HUMAN 分享可以先持久 coordinator 再产生平台授权 AE；
因此仅查 Core EE 或已存在的 nativeHumanOrigin 会漏掉原生 UNKNOWN。

四步影响：

1. 权威：复用原 binding disable Workflow、原系统策略签发 management ActionToken、
   Core PEP、原 Job/Task 与原 Task receipt；不新建 EE、任务账本或权限权威。
   原 REMOTE_ADAPTER reconcile 现在有真实 binding 请求/结果 DTO；旧适配器不支持时
   保持 DISABLING，不把 404、失败或缺 ACK 当空集合。PROTOCOL_PEER 原路径保持。
2. 影响面：Core 停用 advance/finish 在锁内比对原 reference；client-kit 管理验签、
   Cells adapter、jobs/user、原 gRPC ListJobs、Bolt/Mongo DAO 同链消费。
   NativeCellJob.Metadata 固定 bindingId/generation；同 binding 旧代次一起枚举。
   ClaimJob 拒绝已有更高或相同 generation，且当前 Job 未存在时排空必拒绝；
   因此快照后不能另建旧代次 Job 躲过枚举。Mongo 创建新代次写所有原前代 Job，
   ClaimTask 与停用也写同 Job.claim_revision，事务冲突重验，而非只读后 Insert。
3. 副作用：只有 Core lifecycle PEP 已证明 DISABLING 的 reconcile 可置专属
   Job.Inactive，覆盖 disable 及取消 create；原 create handshake/validate_binding
   不进入此消费者，也不触碰 Cells 其他 Job。Bolt 先完整枚举再同写事务封禁，
   不在迭代原 bucket 时写它；Mongo 使用原存储 snapshot transaction/majority ACK，
   不支持事务则拒绝，绝不降级为 GetJob+Insert。fence 后原 Task 回执/状态写入仍可进行。
4. 异常：完整 EOF、同 binding/generation、原冻结 intent、两个 Task 的成功回执均需成立。
   UNKNOWN、缺配对/ACK、部分 RPC、流错误、超限、缺当前 Job、畸形/旧无归属 Job，
   均不得完成停用；不重派原业务写入、不从当前 Cell 对象推断历史成功。
   超限按现有响应上限拒绝，本批未实现分页；长期 UNKNOWN 仍需既定肯定证据收敛，
   没有新增自动失败/零用量结算。旧分享 Job 不自动归属或解封；新代次投递新的专属 Job。

兼容：新增 DTO 和 Job.Metadata 是本批实际格式扩展，未自动提升线上 release 能力。
旧无归属 Job 仅阻断本分享能力/排空；Mongo 唯一索引仅匹配 NativeCellShareJob=true
且两个归属字段均为 string，不把普通/旧缺字段 Job 索引为相同 null。
必须同步升级 Core/adapter/native writer 再交付该能力，不能混跑旧 Claim writer。
原受管组件 release/binding 尚未激活；本批不证明完整 FILE_STORAGE 七键。

已执行：原 4CPU/8GiB、UID1000 SDK/Data 缓存预检后，tools/gen.sh 四侧生成
22757 exit 0；Dart 两 i18n 生成文件与正式 cmp 0。quicktype 原生嵌套类型从
ExecutionClass 变为 ExecutionElement，三个现有 Worker 消费文件机械同步，wire 不变。
首次 rustfmt 因小快照缺兄弟 mod 报错，未算通过；随后原 rustfmt
`--edition 2021 --config skip_children=true` 四个 Core 文件退出 0。
没有执行 Cargo、Core SQL/行锁或四语言双向运行检查，不以生成成功替代这些验收。

Node 原 HTTP adapter 消费者：正向 16131 exit 0，10/10；实际删除生产
`canonical(result.reference) !== raw` 后 wrong-reference 被放行 200，检查真实失败
（8 pass / 2 fail、exit 1）；apply_patch 原字节还原且 cmp 0 后 10/10、exit 0。
日志目录 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/cells-binding-reconcile/`：

| 原文件 | SHA256 |
|---|---|
| generation.log | 52b398e382b2959e01fb16033b4e4b80dde009698f1f262ed6881c8f1db4f1f2 |
| node-positive.log | c439d6ef54c8c62c261746ed994551de2eb9b12c632bf3095bdd5fab98be841c |
| node-negative.log | d259920ed82f3cd5bb50ea1a65ed70809a479c01ffbb07eae1374fc0abe4e345 |
| node-restored.log | 84328483f38018be6e5d6c912c6c1d051338e4168361dac92367272c7d938330 |

原 Go 28994 仍在途：`go test -tags=kv -count=1 -v -run
'^Test(NativeCell|DAO_NativeCellFenceAndClaim)' ./scheduler/jobs ./scheduler/jobs/dao
./idm/share ./scheduler/jobs/grpc`，Data 私有目录 `.native-cell-reconcile.MHdjoL`。
尚无其终态，不声明原 DAO/Mongo/真实部署排空验收通过；后续只补事后证据。

v2 交叉复核修正：binding reconcile 分支落入实际签票/PEP 消费的
`action_token::lifecycle_observation_revision`，普通 EE `observation_revision`
没有扩展为 binding 操作；取消 create 已处于 DISABLING，同样必须 fence。
原 28994 输入是 v1，终态不能当 v2 REST/gRPC 验收，须顺序补最终窄验。
PROVISIONING 边界：`application_binding::prewrite` 在同一事务中
插入 binding 及 PENDING application_runtime，正常已提交 binding 不存在无 runtime
的合法窗口；但原 Cells Job 来自 `EnsureNativeActionJobs` 的独立启动投递，
不由该 Core 事务保证。取消发生在 native Job 未创建时，本批仍拒绝完成排空；
没有持久肯定的未创建/未执行证明接缝，不把缺 Job 当空集合或称所有取消闭环。

2026-10-11 主线程接管 v2 验证。原 28994 日志实际包含
`undefined: jobproto.JobServiceStub`，不是通过；该符号在固定源码不存在。
`native-cell-reconcile_test.go` 已复用原 `task-receipt_test.go` 的 bufconn、
JobServiceServer 注册与真实 gRPC ClientConn，不创建另一套 stub。
原 gRPC 生命周期检查的 OIDC 响应漏掉原消费者必需的 `expires_in`，现补齐
测试响应，不放宽生产 token 校验。两份最终源码与 SDK 输入逐字节 cmp 退出 0。

同一 4 CPU/8 GiB、UID1000 SDK 和 Data 缓存执行，最初一次漏投递
CELLS_WORKING_DIR/CELLS_DATA_DIR，退出 1、没有业务检查通过；失败日志保留。
正确投递到原私有 `.cells-runtime` 后，最终命令 79963 退出 0：

```sh
go test -tags=kv -count=1 -v -run '^Test(NativeCell|DAO_NativeCellFenceAndClaim)' \
  ./scheduler/jobs ./scheduler/jobs/dao ./idm/share ./scheduler/jobs/grpc ./scheduler/jobs/rest
```

原 jobs、Bolt DAO、share 和 gRPC 四包通过；REST 包无检查对象，只经过编译，
不是 REST 业务验收。gRPC 的 disable、create-cancel 均实际冻结原 Job，随后
ClaimTask 拒绝；PEP 拒绝、错误 SERVICE 和错误 generation 不冻结 Job。
私有生产副本把 SnapshotNativeCells 的 fence 参数改为 false，原检查在两条允许
路径报 `actual original Job fence differs`，34360 退出 1。按正式字节还原、cmp 0，
同一检查 24191 退出 0。没有改生产状态、删除数据或弱化检查来取得通过。

日志位于 `/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-cell-reconcile.MHdjoL/`：

| 日志 | SHA-256 |
| --- | --- |
| binding-v2-final.log | `2fd46e2b36c357588f832ce87fffa2fb10dd8486bc150e1590557136700274bc` |
| binding-v2-negative.log | `101005a8f4ffe87d4541b57514df0207fb5a1f26293f9b8b73004207120f12d5` |
| binding-v2-restored.log | `cef65275addc0576557befa4bf9491edacaf5ca279ee53a9429fdd2575ecb298` |

Mongo 事务、真实 HTTP/部署排空和 native Job 尚未生成的取消窗口仍未验收。
这组结果不表示 release/binding 已激活，也不表示三组件菜单或完整文件操作已交付。

### 2026-10-11 完整原生页面构建发现的删除依赖遗漏

DD-87/88 与原生删除接入沿原 access.gateway 的 deleteAction 与
emptyRecycle 调用 nativeDelete；后者引入 uuid4 生成并持久化请求幂等键，
但该 workspace 没有声明依赖。完整 Cells 服务构建在真实 webpack 阶段报
`Module not found: Error: Can't resolve 'uuid4'`，不是原页面可交付。
固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`frontend/assets/gui.ajax/package.json::dependencies.uuid4` 已固定 1.1.4，
同一 pnpm 锁已含 package 与 snapshot。本次只给真实消费者 access.gateway
补同版本直接依赖和 importer；没有增加依赖版本、替换 UUID 实现或页面。
影响仅构建依赖解析；请求键、重复投递、UNKNOWN、作用域、审批与授权逻辑
保持不变，无数据迁移与兼容窗口，无三端协议变化。后续构建结果另记，不能
用此前镜像代表此输入已经验收。原失败日志为 Data 下
`build-file-storage-service.njBcUC.log`。

同批 adapter 已实际构建、推送并以 registry HEAD 200 回读：source digest
`2faa5d991004a95e3d830a5e5d748201b4fb2e6a01db06632fa498240ce459d7`，
artifact digest `08803a9e0b617f557580c4c28de6d6ac3d4fb3e590b1f61aebbc595cdacf5995`。
正式 manifest 采用实际回执；未部署，未激活 binding，不代表左侧菜单交付。

随后原 `tools/build-upstream.sh file-storage-service` 完整构建（33443）退出 0。
原前端 webpack 完成，Go 二进制实际输出 Cells 5.0.3-dev / Go 1.26.8，
完整镜像导出、推送和来源登记成功。受限 builder 为 8 CPU/16 GiB，
输入快照为 `/volumes/data/kailo/tmp/cells-delivery-release.qFNxaW`，
原日志 `/volumes/data/kailo/tmp/build-file-storage-service.L9RTmB.log` 的
SHA-256 为 `b821e0c3060630980083a440495d8bb9fc83646975df164eeb004aaead9a0932`。

对全部 9023 个源码输入逐字节比较，最初只有 Compose 环境项顺序和
`discovery/install/assets/src/res/build/PydioInstall.js` 的 3 处 CRLF 不同。
后者快照 blob 与 HEAD 均为 `61774b1dce9cd341b613c70f4414f23b2849f80c`；
正式工作树按已跟踪 LF 归一，Compose 保留全部相同值并对齐顺序，未改功能。
原 manifest helper 再算实际 source digest 为
`sha256:dd72501afd81832b75996dc97db559e8a375138a5f105b169ce9392b8fa2b0ba`，
与构建输入一致后才采用原工具的登记结果。registry 独立 HEAD 返回 200，
`Docker-Content-Digest` 为
`sha256:1900f564fa4e64318752369c2a392f76981285c9dfade72b6c93e4c2ac846283`。
这是完整产物构建/推送回执，不是 Git 提交/push、部署、浏览器视觉验收、
ApplicationBinding 激活或 Cells 全功能治理闭合证明。

### 2026-10-11 原生 Job 创建前取消的原子栅栏

本批补齐上文已记录的 native Job 尚未生成窗口，不改变 DD-87/88 与
`.design/07` §5.2、§6.3 的绑定停用、原生副作用及在途对账语义。
固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`scheduler/jobs/dao/bolt/bolt.go::PutJob` 原为无条件 bucket.Put，
`scheduler/jobs/dao/mongo/mongo.go::PutJob` 原为按 ID ReplaceOne/upsert；
不能把这两个原版写者直接用作受治理 Job 的幂等创建。

变更影响面与边界结论：

- 权威：沿原 Job/Task、Inactive 和 binding/generation；没有新增状态、契约字段、
  注册表或审计/工作流权威。属于已授权治理改造，不是页面或功能重设计。
- 写读链：`JobsHandler.nativeCellSnapshot` 在原生命周期 PEP 通过后调用
  Bolt/Mongo `SnapshotNativeCells`。当当前 Job 不存在时，只有 fence 请求才在
  原事务中插入同一 ID、同一 binding/generation 的 Inactive Job；普通观察仍拒绝。
  `ClaimJob`、`ClaimTask` 与该事务/唯一键串行；`PutJob`、`DeleteJob` 不得覆盖或
  删除 frozen Job；`EnsureNativeActionJobs` 接受同一停用身份而不重新启用。
- 副作用：不是将“未找到”直接当作排空。插入前拒绝冲突普通 Job、同代次异 ID
  和孤儿 Task；原所有历史代次与 Task 全量保留，不写任何伪造任务、SUCCEEDED
  或零用量。`ReconcileNativeCells` 仍要求完整 EOF 和当前栅栏；已有在途、缺 ACK
  或缺配对回执仍为 UNKNOWN，不重放原生 ACL/Workspace 操作。
- 异常：取消 context、超限、数据库异常均使事务回滚；竞争创建在同一事务或
  原唯一键冲突处拒绝，不能获得成功空集合；重复 fence 保留同一事实。既有 PEP
  DENIED、投递 PRECONDITION、大小 LIMIT、原存储 CONFLICT 不变；无法取得完整
  观察时沿原 UNKNOWN 收敛路径，不声明停用完成。Web/Desktop 原生页面消费者
  不变，Mobile 非组件宿主边界不变；无需契约迁移或新增兼容读路径。

先实现两个 DAO 分支，再扩展现有 DAO/gRPC 用例。复用
`kailo-cells-native-check-lftow7`，回读 4 CPU、8 GiB、等量 memory+swap、
UID1000；Go mod/build 缓存、临时文件、私有源码均实际 bind 在 Data。
镜像 `golang@sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`。
四个改动源码与 SDK 输入经 gofmt 后逐字节 cmp 退出 0。最终命令：

```sh
go test -tags=kv -count=1 -v -run '^Test(NativeCell|DAO_NativeCell)' \
  ./scheduler/jobs ./scheduler/jobs/dao ./idm/share ./scheduler/jobs/grpc ./scheduler/jobs/rest
```

57139 退出 0：jobs、Bolt DAO、share、gRPC 四包通过；真实 gRPC 的
create-cancel-before-job 经 PEP 到 DAO 后再执行实际 EnsureNativeActionJobs，
栅栏仍停用，迟到 Task 被拒。DAO 覆盖首次创建竞争、重复取消、迟到覆盖/删除、
历史在途 Task 保留、孤儿任务、错 Job/代次、超限及取消 context。
仅私有副本将缺 Job 分支的 Inactive 改 false，20556 退出 1，原文
`empty cancellation was not durably fenced`；还原与正式源码 cmp 0 后，
同一最终命令 82756 退出 0。正式源码未被破坏。

日志仍在 `/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-cell-reconcile.MHdjoL/`：

| 日志 | SHA-256 |
| --- | --- |
| cancel-before-create-final.log | `efc66877c4841dc33b59ef5f1e9e7acc1700e09b93e938643d9fdf8f6e7538e0` |
| cancel-before-create-negative.log | `119829f9740ce588be436d745c2205e31dd265f952ba90193f2e97980a5637e8` |
| cancel-before-create-restored.log | `b10a088ecc892d86161d63755554dee92fd1b060bf57f239ea222c1adeb15985` |

Mongo 实例未投递，只有编译，不是 Mongo 事务验收；REST 包显示 no test files。
未做真实 HTTP/部署排空、进程崩溃恢复、浏览器截图或 Windows/Mobile 验收。
本批源码尚未进入上文完整镜像，不将旧产物摘要冒充本批产物；没有部署或激活
binding，也没有因本批宣称三个菜单已交付。全量工程检查与 Git 收口由主线程集中执行。

## 2026-10-11：PEP 冻结 binding 代次兼容闭包

本批只交付 Adapter PEP 可选 `bindingGeneration`，不是 Cells/Wren 完整治理、
原生 binding fence、绑定停用 reconcile 或运行部署完成。独立源码输入为
`39c0f45c8801576a2cd006c5eb5ce658c18d1f05` 加本节列出的 13 个相关文件；
提交基线重组到 `e33e3bcf1d8f6f59c9070fde3ea30aed62adb50b`，其间变更不碰本批
文件。未夹带尚未闭合的 binding reconcile schema、生成类型及管理动作放行。

权威与影响：沿既有 ActionExecution 冻结 `component_projection_generation`，
不加第二份 token 或凭据权威。Core 普通业务、SERVICE_READ_RECEIVER 与
SERVICE_READ 三个返回点均先通过原授权，再用同 AE、同 binding 查正数代次；
读不到、绑定不匹配、代次非正数均拒绝，不借当前部署 generation 填补。
该可选字段经原 `tools/gen.sh` 生成 Rust/Go/TypeScript/Dart，缺省保持省略；
共享 `freshPep` 对已出现字段强制安全正整数。旧响应继续可读，不代表缺字段的
原生写入消费者可以猜测来源；需要冻结代次的新任务仍须自行拒绝缺省。
本批不改数据库字段、既有执行状态或 Temporal 历史，不产生外部副作用。

发布顺序不可颠倒：旧版共享 `freshPep` 使用 exactKeys，会拒绝新 Core 带
`bindingGeneration` 的响应。先部署本批兼容消费者（接受有/无字段），再部署
Core，最后启用依赖代次的新原生任务；未配对升级不可激活。schema 可选只保证
本批消费者保留旧响应读取能力，不代表旧 adapter 接受新回应。PROTOCOL、
protocol session 和管理 PEP 分支本批保持现状，不承诺返回该字段。

执行环境：复用固定 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；
生成/Node/contract 为 2 CPU/4 GiB，Rust/Go/Dart 为 4 CPU/8 GiB，禁额外 swap，
缓存、临时文件与日志均在 Data。证据根为
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt`；独立源码目录
`pep-independent.rcQHRc`。原执行命令与终态：

```text
bash tools/gen.sh
  exit 0；四侧实际生成（pep-independent-gen.log）
cargo test --manifest-path core/Cargo.toml -p contracts pep_binding_generation_preserves_legacy_absence
  exit 0；1 passed（pep-independent-rust-restored.log）
(cd worker && go test ./internal/contracts -run TestPepBindingGenerationPreservesLegacyAbsence -count=1)
  exit 0（pep-independent-go-restored.log）
node --test --experimental-strip-types --test-name-pattern="PEP binding generation" client-kit/ts/contracts/test/roundtrip.test.ts
  exit 0；1 passed（pep-independent-ts-restored.log）
(cd client-kit/dart && dart test test/roundtrip_test.dart --name "PEP binding generation")
  exit 0；1 passed（pep-independent-dart-restored.log）
node --test --test-name-pattern="shared PEP consumer|PEP response|HTTP protocol reaches|binding validation|binding handshake|native actor proof|native error mapping" file-storage/adapter/test/query-revision.test.mjs
  exit 0；93 passed（pep-independent-consumer-restored.log）
cargo clippy --manifest-path core/Cargo.toml -p platform-core --all-targets -- -D warnings
  exit 0（pep-independent-clippy-restored.log）
```

contract 沿原 `tools/check.sh` 的 `step_contract` 函数执行（加载原函数、跳过
全工程依赖安装，仅执行该已有步骤；未新建检查器），`pep-independent-contract.log`
exit 0：四侧生成物同步、相对 contracts-v0.1.0 无破坏性变更，302 个 schema 中
匹配 3 个历史 schema。该历史门禁覆盖范围不是对所有旧客户端实现的运行证明。

事后破坏验证仅改私有候选：删除共享代次合法性判断后测试实际收到 200、预期
503 而失败（`pep-independent-consumer-negative.log`），恢复后 93 项通过。
样例增加未知字段 `unexpectedBindingGeneration` 后，四侧回环分别退出
Rust 101 / Go 1 / TypeScript 1 / Dart 1；`pep-independent-*-negative.log`
保留失败，恢复样例后上述四侧全部通过。正式树从未写入这些故障。

失败如实保留：首次独立 Core 导出缺少已提交 ext_mcp.proto，clippy exit 101；
补齐同基线原文件后通过。完整 adapter 文件首次导出缺原 frontend 测试输入，
718 项中 429 通过/289 失败；补齐同基线原输入后仍 655 通过/63 失败
（`pep-independent-consumer-full-restored.log`），包括既有浏览器 fixture
`ReferenceError: uuid4 is not defined`。独立导出原 HEAD、无本批修改的同文件
基线为 710 项 647 通过/63 失败（`pep-independent-head-baseline.log`），
63 个失败名称逐项相同；本批新增 8 项通过，但完整 adapter 套件仍未通过。
本批未执行全局 `--full`、真实 Core PEP 数据库 HTTP 链或 UI/设备验收，未部署。

## 2026-10-11：绑定停用拒绝未来原生观察时间

本次仅修正既有停用对账消费者 `application_binding_native::reconcile_complete`
的观察边界：`lastObservedAt` 不得晚于 Core 本次读取的当前时间，既有
`terminalAt <= lastObservedAt` 判断保留。终态及 UNKNOWN 的未来时间均拒绝，
不能靠未来证据完成停用或退休凭据。没有新状态、时间阈值、数据库字段或降级路径。
语义沿 `.design/07` §5.2、§6.3 与既有
`application_execution::observation` 的未来观察拒绝规则；只改原消费者及其事后检查。

该函数属于尚未提交的 NativeCell/Core 绑定停用闭包，本修复不能脱离其 schema、
四侧生成及原生消费者直接算作可发布补丁。窄验使用此前原闭包树
`3e1eda2c0e4046863d4ccb4a0dd7cb8897fa5ffa` 加本次单文件修正，不冒充当前
main 全量验证。复用 `kailo-cells-closure-kxbrvt` 原 SDK，4 CPU/8 GiB、无额外
swap；原缓存、输入和日志全在 Data，不新建构建环境。

实际命令为：

```text
cargo test --offline --locked --manifest-path core/Cargo.toml \
  -p platform-core --bin platform-core \
  native_binding_reconcile_requires_complete_exact_terminal_evidence -- --nocapture
```

证据目录为
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/future-observation.9Lgfes`。
`positive-registry-input.log` 退出 0：1 passed、424 filtered out，SHA-256
`1101303161bc95349cba040fefc1b40f758cd7001a83dbb6abd3e840a482ae50`。
仅在私有副本删除本次生产判断后，同一检查以 `future-observation` panic
退出 101（`negative.log`），SHA-256
`b10e8ea320b1439ad40e8733d321b829041bce22d86adf51200d664961ccfd41`。
判断随后恢复，正式与私有单文件 `cmp` 退出 0；恢复复验命令增加该文件
`rustfmt --edition 2021 --check`，session 45830 最终退出 0：格式检查通过，
1 passed、424 filtered out。`restored.log` 的 SHA-256 为
`662f0fc49133652f58658aa8d261aa00eacd75c4b13f79215b67a097d77e5fe4`。

首次格式检查失败已修正；两次私有输入缺失（原 Buzz workspace Cargo.toml、
原 tools/registry/capabilities.yaml）分别造成编译退出 101，补齐同树原输入后
才得到上述正向结果。最后复验曾在 Docker 执行入口无输出，主机当时只读采样
D 状态 612 个、load 651.47/379.42/204.12；未追加容器或重试构建，原作业恢复后
完成编译 35.25 秒并通过。该恢复终态仍仅属于上述旧闭包加单文件修正。
本节不证明真实 HTTP/数据库停用、完整 NativeCell、其他组件治理、上线或菜单验收。

### 同日：精确归并候选四侧生成同步

以 main `8ec54d517c17157e8f5a3e14a6eb9ed37d795309` 为基线的 60 路径私有
候选 tree `ea2d35de24c501034fbb4ce53d1196210ab9463e`，保留已提交 Agent
时间字符串及可选 PEP 代次。四份生成文件由原生成结果与已提交修复三方归并，
本轮随后实际使用原 `tools/gen.sh --check` 验证，不靠合并成功判断同步。

仅从该 tree 导出 contracts、原生成脚本、四侧生成落点及 i18n 原实际输入/输出；
未复制全仓、未混入正式 i18n 脏改、未写入正式生成物。输入和日志在
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/gen-check-ea2d.vi1XYe`。
复用原 `kailo-cells-closure-kxbrvt` 4 CPU/8 GiB SDK；启动前确认 Wren 原
builder 8 CPU/16 GiB、知识 Go 与 Web 各 4 CPU/8 GiB，主机可用内存约
40.6 GiB、D 状态 1 个；没有增加容器或重开任何构建。

首轮 43577 退出 1：复用 SDK 未补原 `tools/check.sh` 的 npm 缓存环境投递，
四语言均报 `npm EAI_AGAIN registry.npmjs.org`，尚未比对生成物；Mobile 词条
同步通过。保留 `generation-check.log`，SHA-256
`a7b8db0ed9ac60c5ab690ec2079ef521f6c10af50b05cdb478ff632564cf25f2`。
确认 Data 原缓存中固定 quicktype `23.0.171` 已存在后，只恢复原 runner 的
`npm_config_cache=/cache/npm` 并增加 `npm_config_offline=true`，同输入、同 SDK
运行 `bash tools/gen.sh --check`；未联网安装或修改原生成脚本。

原句柄 25851 退出 0：Dart、Rust、TypeScript、Go 四侧均显示同步 PASS，
Mobile platform/reason 词条同步 PASS。`generation-check-offline.log` SHA-256
`e4f0fe74c3ed4493881f06f68e24c100aa7ccf811e925991008ed7a448a18975`。
本步骤不包含四侧运行回环、Core/Worker 编译、数据库停用或完整工程检查；后续
Cargo 窗口由主线程协调，未因本结果宣称这 60 路径全部验收或组件可上架。

### 同日：精确归并候选 Core 原生消费者

获主线程单批窗口后，对同 tree `ea2d35de24c501034fbb4ce53d1196210ab9463e`
导出 Core/contracts、原 Buzz Cargo workspace/crates、AgentGateway proto 与 registry
实际编译输入；未复制全仓、未混入正式树其他修改。复用原 4 CPU/8 GiB SDK 和
Data 缓存；启动前主机可用内存约 36.5 GiB，原 SDK 仅有 sleep，无并行 Cargo。

```text
cargo test --offline --locked --manifest-path core/Cargo.toml \
  -p platform-core --bin platform-core native_ -- --nocapture
```

原句柄 96237 最终退出 0，编译链接 5m09s；108 passed、0 failed、11 ignored、
307 filtered out。其中原权限来源、精确权限结果、幂等来源 hash 和原绑定完整
终态证据（包括未来时间拒绝）均通过。链接进程曾等待磁盘 I/O，未取消或重复执行。
输入与日志为
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/core-ea2d.k2xgy8/native-core.log`，
SHA-256 `a5ef96e66f25c5441ce55aa66219b7af4263a5154cccca13454e7a7bcf86d5cf`。

11 项 ignored 需要原独立已迁移数据库；日志另明确
`SKIP Automation阶段SQL证据：未投递独立空库 DATABASE_URL`。它们不是数据库
通过证据，本步骤也不等于完整工程门禁、真实原生 HTTP 停用、Mongo 运行验收或
组件发布。仅随后追加回执、重组 Git 基线，不改变本次已验源码。

## 2026-10-11：SOURCE 目录回执后原生披露复核

权威与影响：按 `.design/13` §4.4/§7 和 `.design/07` §8.2，只有完整且
授权成立的枚举才能作为接收方 desired set；查询失败、撤权和来源变化都不是
源文件删除。固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`gateway/restv2/api-lookup.go::Handler.Lookup` /
`Handler.isListingLookup` 和
`gateway/restv2/api-versions.go::Handler.NodeVersions` 为已有原生读取路径。
本批不改上游接口、业务页面、数据库、契约或权限权威。

原缺口在 `file-storage/adapter/src/service-list.mjs::listFiles`：回执前两次
完整原生遍历及 fresh PEP 成立后，SOURCE 回执 HTTP I/O 仍可能经历原生 ACL
撤销、节点移动、版本替换或目录变化；回执后仅重查平台 PEP 不能证明该原生
集合仍可披露。本批在现有最终平台 PEP 前复用 `nativeListing`，要求第三次
完整集合的 canonical 值与原集合一致。所有遍历共用原 deadline、最大体积
和枚举限制，不增加默认阈值、缓存 allow、正文复制或第二执行记录。

异常与副作用：原生拒绝/无法枚举继续原 503；完整集合不一致为原 409，
绝不返回旧集合或将查询失败伪装为空集合。最终平台 PEP 保留，可在新增
原生复核期间撤权时拒绝。SOURCE 回执已写而最终披露失败，仍只证明源侧
既有读取，不证明 RECEIVER 完成；调用结果不明保持原操作的对账/重试边界，
不得合成同步成功/失败终态、替换 operation/idempotencyKey 或签发新 grant。
本批不改变原重试观察同 creation/task 的路径，不补造历史绑定代次。
Web/Desktop 的组件宿主和 Mobile 非组件宿主边界不变。

验证输入由已提交 `beacab8ca6585d489037e6951b3fe380ceda654a` 精确导出
原 adapter 与共享 client-kit/adapter，再加入本批两文件；没有混入尚未合入
NativeCell/reconcile 测试 fixture。复用原 SDK `kailo-cells-closure-kxbrvt`
4 CPU/8 GiB（无额外 swap）；开始前确认仅 sleep，无活跃检查，主机可用内存
约 27.5 GiB。缓存、临时输入与日志均在 Data，不读写 rust-target。

```text
node --test --test-name-pattern="^SERVICE" file-storage/adapter/test/query-revision.test.mjs
  positive.log：exit 0，95 passed / 0 failed / 0 skipped
node --test --test-name-pattern="^SERVICE directory discovery refuses native changes during receipt I/O" file-storage/adapter/test/query-revision.test.mjs
  negative.log：exit 1，8 个子场景和父测试共 9 failed
node --test --test-name-pattern="^SERVICE" file-storage/adapter/test/query-revision.test.mjs
  restored.log：exit 0，95 passed / 0 failed / 0 skipped
```

事后破坏仅在私有副本准确移除新增的回执后 nativeListing 比较，保留回执前
两次遍历及所有 PEP。根/成员 ACL 撤销、根回收、成员移出、版本替换、集合
变空、重命名和枚举不可用 8 例均实际收到错误的 200（预期 409 或 503）。
恢复该行后，生产文件与正式树 cmp 退出 0，原 SERVICE 检查再次全部通过。
这些检查调用实际 adapter HTTP 消费者，但原生服务、Core PEP 与回执接收端
为隔离 fixture；不是在线 Cells/Core/WeKnora 联调或完整组件上架证据。

日志目录：
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/source-list-receipt.z0gr9h`。
SHA-256：

- `positive.log`：`52f3758d9e38427a4c85937fdf05ef68dcc60921a67b9d76eeb9c5d56de3eed2`
- `negative.log`：`8511716e89942f4a72c7374b8ec721c51ee61e25db4b33a4dad7c08254e5204d`
- `restored.log`：`97cd55161befd0f19ab810bced38943e6306679834ba97c3b90b55c8b49de9b1`

本批未运行全局 --full、真实数据库/原生部署、浏览器截图或三端设备验收，
未产出镜像、未部署或激活组件。知识库延迟接收任务的可信持久关联和 fresh
执行入口仍由对应消费者闭合，不因本 SOURCE 披露修复而宣称跨服务同步完整。

## 2026-10-11：NativeCell 首次跨代次 Mongo 竞争更正

继续沿原 ClaimJob / SnapshotNativeCells 消费者追查，确认此前 Mongo 说明
不覆盖首次跨代次竞争：两个 snapshot transaction 都可能读到同 binding
无 Job，低代次创建与高代次空集停用各插不同 Job ID / generation，原唯一键
不冲突。Bolt 单 writer 事务没有这个窗口；旧 Mongo 编译结果不能证明它安全。

按 `.design/07` 原 generation 停用和完整在途对账边界修正原 Mongo Job DAO：
在同一原 Job 行持久化 `claim_binding` 协调键，首次 ClaimJob 和空集 fence
争用同一 partial unique index；有原行时两者都在原事务内触碰该原 Job。
没有新 collection、合成 Task/终态、平台实体、权限或第二账本。原 Migrate
先核对原 Job 可信 binding/generation 并迁移现存行，再启用唯一索引；重复或
错误归属拒绝启动，不覆盖、不猜来源。没有适用 NativeCell 行时无数据迁移，
不要求独立安装为了普通原生业务使用事务。已有锚点原 Job 随原任务证据保留，
原 PutJob/DeleteJob 保护仍生效；后续新 generation 不继承旧 generation 的
Inactive 状态，其他 binding 和独立原生 Job 不变。

唯一键竞争必须使整个事务失败，保持原 UNKNOWN / 同一意图重试；不能吞异常
返回空 `complete`。既有任务完成证据更新不被截止，新任务 claim 与截止在
同一原 Job 写冲突下串行。新增数据库协调字段不出原 Job API / 四语言契约，
不改变 Web/Desktop 原页面或 Mobile 非组件宿主边界。原 DAO 事后检查现同时
覆盖同代次与首次跨代次创建竞争，仍使用原存储测试入口。

在此更正前，精确旧候选 tree
`260a9487ed90f7a18a9fddd5cdacd157ccddd011` 已用原受限 Node SDK 取得：

```text
node --test --test-name-pattern="binding reconcile|original Cell|unknown Cell|Cell save" file-storage/adapter/test/native-cell.test.mjs file-storage/adapter/test/binding-reconcile.test.mjs
  exit 0，26 passed / 0 failed / 0 skipped
node --test --experimental-strip-types --test-name-pattern="binding reconcile preserves" client-kit/ts/contracts/test/roundtrip.test.ts
  exit 0，1 passed / 0 failed / 0 skipped
```

日志目录为 `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/native-node-260a.fehJNf`；
`consumer.log` SHA-256 `d52d4c6afa86158783a39d73a67d1080987f4257863fe3ba5b5283b83821a552`；
`ts-roundtrip.log` SHA-256 `eebbb72a86a0981ae333c70259a08e1a1daa9b212c6f71fe8d5356f9bdee1e35`。
它们调用原 UI 函数/adapter HTTP fixture，不是 Mongo 或在线 Core 停用验证。

本次三文件更正经原 `kailo-cells-native-check-lftow7` gofmt；容器复用原
4 CPU/8 GiB 限额、独立 Data Go mod/build 缓存，依赖访问为 offline/readonly。
原句柄 23983 执行 `go test -tags=kv -mod=readonly -count=1 -v -run
'^TestDAO_NativeCell' ./scheduler/jobs/dao` 尚无终态；原 Go 线程有 Data 页读取
等待，未重复启动。隔离 `CELLS_TEST_MONGODB_DSN` 未投递，Mongo 实例事务、
迁移与针对性破坏反证均未验证。旧 60 路径 tree 不包含本更正，不可直接提交；
也不得将此前 Node/TS 或后续 Bolt 结果当作 Mongo 实例验收。未部署、未激活。

### 当前部署后端与精确候选证据适用性

2026-10-11 只读核验：原 `kailo-cells-native-cells-1` 的实际 Cells 子进程
`3627` 在 `/proc/3627/fd/24` 打开
`/var/cells/services/pydio.grpc.jobs/jobs.db`；该容器原 bind mount 指向
`/volumes/data/kailo/components/cells/data`，其 `pydio.json` 的
`databases.boltdb.driver` 为 `bolt`，没有 jobs 服务存储覆盖。核验仅输出
driver、挂载与打开文件路径，没有读取任务正文或投递秘密。Compose 的独立
PostgreSQL 是其他原生数据的后端，不能据此推断 Jobs 使用 SQL 或 Mongo。
因此本部署按 Bolt 适用性验收，不另起 Mongo 基础设施；Mongo 的首次并发、
迁移和真实事务反证仍未验收，Mongo 部署不得引用 Bolt 结果批准这项能力。

本轮候选以 `36e63a2d0cbe2ce4c89f90696215b80bd635247f` 为底，仍限定原
60 路径。已完整对照旧验证输入与新候选：Core 七源码、契约 schema/sample、
共享 PEP 与原 Cell UI/adapter 消费者保持原验证内容；新差异是 Mongo 两源码、
原 DAO 竞争检查、回执及已提交 SOURCE 披露检查的保留，不回退 main 成果。
下面逐项区分重用证据和未跑范围，不将整个新树写成全量通过：

| 范围 | 实际结果与新候选关系 |
| --- | --- |
| 四侧生成同步 | 精确 ea2d35de 原 `gen.sh --check` exit 0；本批 schema、生成文件与该输入逐字节相同。未重复生成。 |
| TypeScript binding reconcile 回环 | 精确 260a 原运行 1 passed，生成文件、检查和样例与新树相同。 |
| Rust / Go / Dart binding reconcile 回环 | 原 `cells-native-closure.KxbRvt` 中各一组正向、未知字段反证和恢复通过。两 schema/样例与新树相同；已完整复核生成差异只涉及 main 已提交的 Agent 时间字段及注释，binding DTO/序列化未变。Rust/Dart 检查仅格式差异，Go 检查原字节相同。这是该合同的历史等价窄证据，未重跑新树三语言整套回环。 |
| Core 原生消费者 | ea2d 原 `native_` 108 passed、11 ignored；七个实际源码与新树相同。依赖原数据库的 ignored/SQL SKIP 仍不计通过。 |
| 原 Cell UI / adapter | 260a 原 26 passed；生产消费者与新树相同，未重新执行整个 adapter 套件。 |
| Bolt / Mongo DAO | 23983 因缺原运行目录配置退出 1；补齐后的 49474 与反证还原后的 2514 均 exit 0，Bolt 五组通过。Mongo 无隔离 DSN，真实事务不在本轮范围。 |
| 平台与原生实际停用 | 没有真实 Core HTTP/数据库至原生完整链验收；release/binding 不激活，未新部署。 |

旧三语言回环恢复日志均在
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/`：

- `rust-binding-restored.log`：`5dc60a8231aff3c93b53d969d8441f80e03562db7528fd8f5006f10935b3af88`
- `go-binding-restored.log`：`aa20249bfb3eeb39fcdd60756e716ec38a517fbb4331063561c64510e74be934`
- `dart-binding-restored.log`：`c2372174d682ef2df983890316f4858c85da2b34ea8ee8e138d7c09583eeecdc`

对应 `rust-binding-negative.log`、`go-binding-negative.log`、
`dart-binding-negative.log` 实际拒绝新增的未知字段，恢复样例后上述检查通过；
没有将这些旧日志改名或冒充本轮新树完整运行。

原 23983 于 09:49:35 UTC 输出 `Could not create local data dir ...
-/.config/pydio/cells` 及 DAO `FAIL`：本次命令遗漏原
`CELLS_WORKING_DIR` / `CELLS_DATA_DIR`，测试进程在原 runtime 初始化即退出，
没有执行 DAO 业务断言。`mongo-anchor-bolt.log` SHA-256 为
`674b7e5ee69ea362500e82007d535b06d2e57674fd34c9294a37ce5a324d0c28`。
原 `.cells-runtime` Data 目录仍存在；只补回这两个既有配置，不修改生产源码、
不重建容器、不联网下载，并保留原失败。外层 Go 清理尚未结束，不并行重跑。

### 同批 Bolt 正向、破坏与还原终态

原 23983 外层最终退出 1 后，确认原 Go 进程消失，才顺序补齐配置执行：

```sh
CELLS_WORKING_DIR=/workspace/file-storage/.native-cell-reconcile.MHdjoL/.cells-runtime \
CELLS_DATA_DIR=/workspace/file-storage/.native-cell-reconcile.MHdjoL/.cells-runtime/data \
GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
go test -tags=kv -mod=readonly -count=1 -v -run '^TestDAO_NativeCell' ./scheduler/jobs/dao
```

入口仍是原 `kailo-cells-native-check-lftow7`，4 CPU / 8 GiB、无额外 swap，
独立 Data Go mod/build 缓存；未创建新容器、安装依赖或并发写共享缓存。
49474 exit 0：五个顶层 DAO 检查在 Boltdb 后端通过，包含原完整枚举/Claim、
取消先于创建、原在途保留、冲突拒绝及同/跨代次首次创建竞争；业务运行 0.347s。
Mongo 模板的 `CELLS_TEST_MONGODB_DSN` 未投递，原 Condition=false，没有执行
真实 Mongo；两份 Mongo 新源码随原 DAO 包编译不等于事务或迁移实测。

事后只在私有输入的 `scheduler/jobs/dao/bolt/native-cell.go`，将缺失 Job
分支的 `job.Inactive = true` 改为 false。92973 exit 1：原
`TestDAO_NativeCellCancelBeforeCreate` 在 `empty cancellation was not durably
fenced` 断言真实失败；随后同进程原检查框架发生父级 Fatal/DAO 清理超时，
日志完整保留，这些级联失败不另计为新的反证。正式工作树和私有提交候选
从未包含该故障。apply_patch 原字节还原、cmp 正式文件退出 0 后，2514
同命令 exit 0，五组全部恢复通过（0.430s）。最终三份 Mongo/DAO 改动及
Bolt 生产输入均再次与正式源码逐字节比对成功。

日志仍在原 `.native-cell-reconcile.MHdjoL`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `mongo-anchor-bolt-configured.log` | `5ce7c53ab8b645451af1e61a12354e0d4804b702d092372f67a1535b8821587d` | 正向 exit 0 |
| `mongo-anchor-bolt-negative.log` | `c3c960c2dc70f85e9f4540e03362eb105cece421467961ec84d8beb7767320f3` | 破坏 exit 1 |
| `mongo-anchor-bolt-restored.log` | `1430f53e483b06fc984e8c78dbdba4f9cdd987098dcda23fb5ddf9c430de2b9d` | 还原 exit 0 |

本轮只闭合实际部署所用 Bolt DAO 的该源码与反证；没有新部署、真实 Core
停用全链、Mongo 实例验证、浏览器/设备验收或新增 release/binding 激活。

## 2026-10-11：原 Workspace 写入失败不得被策略写入覆盖

固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`idm/workspace/grpc/handler.go::Handler.CreateWorkspace` 在 `DAO.Add` 返回
错误后仍执行 `DAO.AddPolicies`，后者会覆盖同一个 err。策略写入成功时，
原 handler 会返回 Workspace 并发布 CREATE/UPDATE，掩盖 Workspace 写入失败。
本批直接把原错误检查移到 Add 之后，不增加第二条写入链或成功条件。

四步影响结论：

1. 权威为 DD-87/88、工程规则 9/10/15 与原生终态证据要求；状态是原上游
   缺陷需二开修正，不扩大 NativeCell 只读成员变更的授权范围。
2. 实际消费者是原 share.Client.UpsertCell 最后的 CreateWorkspace RPC，以及
   原独立 Workspace 写入口；DAO、schema、协议和四侧生成不变，无数据迁移。
   NativeCellPut 对 UpsertCell 错误仍返回原 nativeCellUnknown，保留原 Task
   与同一请求键，不追加完成回执，不把部分 ACL 副作用标记为失败或成功。
3. Add 错误必须原样返回，之后不调用策略持久化、不发布成功事件；AddPolicies
   自身失败仍保持原错误。没有新增状态、账本、重试或自动清理副作用。
4. 已覆盖有/无策略、DAO 取消/超时/写入错误及成功 CREATE/UPDATE；错误
   沿原 RPC 映射，不新增六类错误之外的分类。异步撤权、分区恢复与重复
   投递仍走既有消费者，不因本修复增加验收范围。

事后检查 `idm/workspace/grpc/handler_test.go::TestCreateWorkspacePreservesWriteFailure`
复用原 TemplateSQL/SQLite、原 Workspace DAO 和原 handler；只在 DAO 边界
注入写入错误，以原 broker 接口记录事件。九个场景包含六种 Add 失败组合、
正常创建/更新、策略写入失败。它不等于真实 Core 准入或在线数据库故障演练。

原受限 SDK `kailo-cells-native-check-lftow7`（4 CPU / 8 GiB、Data 独立
mod/build 缓存）顺序运行，无下载和新容器。沿原 CELLS_WORKING_DIR 与
CELLS_DATA_DIR，命令为：

```sh
GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local \
go test -tags=sql -mod=readonly -count=1 -v \
  -run '^TestCreateWorkspacePreservesWriteFailure$' ./idm/workspace/grpc
```

首次外层误用 sh 的 pipefail，exit 2，Go 未启动；改用 bash 后 48807 exit 0，
SQLite 一组九场景通过。随后仅在私有生产副本移除新增早返，90262 exit 1，
六种 Add 错误实际返回 nil error/非空 Workspace 并发布事件，有策略时还执行
了策略写入，检查准确拒绝。此破坏未恢复原来靠后的检查，故无策略三项属于
移除早返的反证，而有策略三项直接覆盖原错误被覆盖的缺陷。还原且两文件
与正式源码 cmp 均为 0 后，30209 同命令 exit 0。gofmt 已在原 SDK 执行，
正式两文件与实际验证输入一致。

日志目录 `/volumes/data/kailo/tmp/cells-native-merge.Rz8qB5`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `workspace-write-positive.log` | `f7e685db0505c980f3a93c36d7729f916c15c39cb35418045a3e7246084531fc` | exit 0 |
| `workspace-write-negative.log` | `5ce5cfe60977eb7e5c6b57fde19d99257780ec48896fe4f8fecaa3ec82ee3444` | exit 1，抓到伪成功 |
| `workspace-write-restored.log` | `13f5fa295f58b9417cbc4ad8735f564629345acf1689a465fdc0bca6b8823bdf` | exit 0 |

边界纠正：原 GetOrCreateWorkspace 对非空 UUID 查无对象会拒绝，不会自动
新建；因此没有给该 helper 叠加无效保护。真正的最终 DAO.Add 仍为 upsert，
读取与最终写入间对象被删除的竞态尚未闭合，本批不能替代原子存在性控制。
本批仅源码与定向正反验证；未跑全量门禁、未部署、未激活组件 binding。
