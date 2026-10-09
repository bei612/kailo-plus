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
