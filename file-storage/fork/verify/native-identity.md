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
