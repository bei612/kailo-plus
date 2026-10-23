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

## 2026-10-11：原 Workspace 流读取必须完整结束

固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`idm/share/client-acls.go::Client.GetOrCreateWorkspace` 把任何 Recv 错误都当作
循环结束。已经收到一行后再被拒绝、取消或超时，原方法仍返回该对象；
updateIfNeeded=true 时还会执行 CreateWorkspace。现仅 EOF 代表完整读取，
其他错误原样返回且丢弃部分对象；空响应沿原 ServiceError 拒绝，不把未知
结果改写成 WorkspaceNotFound。没有新 RPC、缓存、权限权威或重试链。

四步影响结论：

1. 权威仍是 DD-87/88 与 fail-closed/原生证据合同，本批修复的是已存在的
   查询失败转成功，不扩展受管创建或成员权限。
2. 全部直接调用包括原 UpsertLink 的新建/更新、UpsertCell、GetLinkWorkspace、
   GetCellWorkspace、DeleteWorkspace，以及本机 ETL api_store 的 Link/Cell
   创建。两个查询封装继续供原 Link/Cell 读取、删除、REST GetCell 和
   cellForNativeUpdate 使用。空 UUID 新建分支未改；现有查询失败的写入方
   现在在修改前停止。协议、数据字段、生成、迁移与三端呈现均无改动。
3. 只有完整查询才可进入后续权限判断和写入；不把部分对象、空响应当完整
   证据，也不在失败时返回可供调用方误用的 Workspace。上层已派发后的错误
   仍沿原 UNKNOWN/同请求核验，不合成失败终态。
4. 正常一行+EOF、零行+EOF、首行前取消、首行后取消/超时/拒绝、空响应
   及首行后空响应均有确定行为。原 Permission/Context/Service 错误不新造
   第七类；并发删除后 upsert、迟到 worker fresh 授权仍未因此闭合。

事后 `TestWorkspaceLookupRequiresCompleteStream` 在原 gRPC 客户端接口注入
逐条响应与真实错误，运行原查询/更新消费者：八组分别执行只读和更新，
共十六场景；对所有失败检查零写入。原六组
`TestNativeShareRequiresPermissionWriteConfirmation` 同批运行，包括独立
Link 新建和原 ACL create/delete/expire/restore 错误保留，不是完整业务验收。
该原检查补用已有 config.WithStubStore，使原 nativeCellWrite 能读取未投递
platform 的独立模式；不关闭鉴权或改变生产配置。

原 4 CPU / 8 GiB SDK 与 Data 独立 Go 缓存顺序执行，GOPROXY=off、
GOSUMDB=off、GOTOOLCHAIN=local，沿原 CELLS_WORKING_DIR/CELLS_DATA_DIR：

```sh
go test -mod=readonly -count=1 -v \
  -run '^(TestWorkspaceLookupRequiresCompleteStream|TestNativeShareRequiresPermissionWriteConfirmation)$' ./idm/share
```

58843 整体 exit 1：新八组通过，原六组因 fixture 缺 config 上下文 panic，
未计为通过。补齐原上下文后 60077 exit 0，两组共十四子项通过。私有副本
恢复上游吞错循环后 4837 exit 1：六个新子项实际失败，其中首行后拒绝/
取消/超时都返回了对象且 update=true 发生一次写入；原六组仍通过。恢复
生产修复、两源码与正式文件 cmp 为 0 后，59951 同命令 exit 0，全部通过。
gofmt 已在该 SDK 执行；正式工作树不包含反证改动。

日志目录 `/volumes/data/kailo/tmp/cells-native-merge.Rz8qB5`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `workspace-lookup-positive.log` | `d2614700a566f4067d0fcbce75f2be18af816d14f7045b420570176a4ea9de1a` | exit 1，原 fixture 缺配置 |
| `workspace-lookup-configured.log` | `d652ff2e809473805e66e94b85fb1ea99393cee78f7e7b8a14f354abd8597e1b` | exit 0 |
| `workspace-lookup-negative.log` | `42e4d8660779ee1d0ab122b3857443811dce025397ee634f7f0381d0fa875ef3` | exit 1，吞错反证 |
| `workspace-lookup-restored.log` | `fed6d50c654034fe2c153ba98c228b06a0bd8c8f80c0d41ea311338172e6a008` | exit 0 |

没有新镜像、部署、在线 Core 准入、三端业务或全量检查证据；未激活组件。

## 2026-10-11：既有 Cell 最终 Workspace 更新不再复活已删除对象

固定上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`common/proto/idm/cells-idm.proto::WorkspaceService` 只有 Create/Delete/Search/Stream；
`idm/workspace/dao/sql/sql.go::sqlimpl.Add` 使用 `OnConflict{UpdateAll:true}.Create`。
因此调用者此前读取过对象不能防止最终写入将并发删除的 Workspace 重建。
同版本 `common/storage/sql/resources/gorm.go::gormImpl.AddPolicies` 使用
`return out, Transaction(...)`，在事务填充 out 之前已求值返回切片，原成功
响应丢失了持久化策略。本批直接修正这两处原链，不新增平台实体或策略权威。

四步影响结论：

1. 权威为 DD-87/88、工程规则 9/10/15 及原生终态证据合同；仍只处理既有
   Cell 的受管成员变更，不开放受管 Cell 创建、WRITE 或新执行入口。
2. 原 WorkspaceService 新增 `UpdateWorkspace`，复用原请求/响应消息，
   仅 managed `Client.UpsertCell` 最终落库调用它。原独立 Create、Link、
   其他创建消费者保持原路。DAO 在同事务锁定已有 UUID 后只 UPDATE，并
   全量替换策略，空集合确实删除旧策略。MySQL 未强制 clientFoundRows，
   所以不使用 changed-row count 判断存在；缺行由事务内锁定读取拒绝。
   原资源 DAO 的 AddPolicies 返回值同时供 user/role/meta/namespace 使用，
   本批修复其真实持久策略返回，不改这些消费者的策略或存储。
3. Workspace 与策略共用原 SQL 事务。Cells 原 Dialector 不转发保存点接口，
   故只在传入资源 DAO 的 tx.Session 设置 GORM DisableNestedTransaction，
   内层仍复用原 ConnPool，错误返回外层统一回滚；没有全局驱动或配置变更。
   UPDATE 事件只在事务成功后发布。旧服务不认识新 RPC 时拒绝，不回退 Create。
4. 缺对象、空请求、原生写错误、策略错误均不返回成功 ACK；空策略不再假装
   已清空。MySQL 同秒相同内容不能被误判为缺对象。NativeCellPut 原有 UNKNOWN
   及同请求对账语义保留：此前 ACL 多 RPC 可已部分完成，最终 Workspace 拒绝
   不意味着整个动作无副作用，不能补发、伪造回滚或改写成失败终态。
   `DENIED/PRECONDITION/CONFLICT/UNKNOWN` 仍沿现有准入与结果映射，未新增
   reason code；`LIMIT/BLOCKED` 门禁未改变。

原 proto 不增加消息字段、数据库列或平台四语言契约；内部 Go RPC 的三份
生成物由原 `buf.gen.yaml`、`buf.gen.tag.yaml` 生成，setter 输出未变。
部署应先具备新原生服务消费者，再更新受管调用方；混合旧服务无降级成功。
Web/Desktop/Mobile 不新增入口或传输路径，组件 release/binding 未激活。

生成沿原 4 CPU / 8 GiB SDK `kailo-cells-native-check-lftow7`，镜像为
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，
用户 1000:1000，memory+swap 与 memory 相等，mod/build/临时输入全部在 Data。
保留以下真实失败：首次私有源未带 cmd 目录 exit 2；原 stub 子模块的
protobuf v1.33.0 未缓存，离线安装 exit 1；改用原源文件及工程固定 protobuf
构建该插件后，tags 的 structtag v1.2.0 未缓存且缺固定正文 hash，exit 1；
一次 login shell 重置 PATH 导致 go not found，exit 127。随后只在原 SDK
取得 go.sum 固定的 structtag，并将原 go.mod 已固定的 x/mod v0.35.0、
x/text v0.37.0、x/tools v0.44.0 三条正文 hash 从工程 go.sum 补入生成器
自身 go.sum，不升级版本。最终离线生成器构建 50272 exit 0；原 buf 两段
29720、最终注释版本 10362 均 exit 0：

```sh
buf generate --output .
buf generate --template=buf.gen.tag.yaml --output .
```

原 SDK 执行 gofmt；沿既有 CELLS_WORKING_DIR/CELLS_DATA_DIR，
GOPROXY=off、GOSUMDB=off、GOTOOLCHAIN=local，集中命令：

```sh
go test -tags=sql -mod=readonly -count=1 -v \
  -run '^(TestWorkspaceUpdateExistingIsAtomic|TestUniqueSlug|TestCreateWorkspacePreservesWriteFailure|TestUpdateWorkspaceNeverCreatesMissingWorkspace|TestNativeCellUpsertConsumesCurrentScopeAndPermission|TestNativeShareRequiresPermissionWriteConfirmation)$' \
  ./idm/workspace/dao/sql ./idm/workspace/grpc ./idm/share
```

24777 首轮 exit 1：share 通过，SQLite 新路径实际报 unsupported driver。
修正上述单事务消费后 82760 exit 0，六个顶层检查通过。SQL 真实覆盖既有对象
更新、不变更新、原策略行 ID、策略失败回滚、空集合清空、先读后删再写拒绝；
handler 覆盖原成功事件及缺行/空请求无事件；share 使用原生成 stub 验证
Unimplemented 和缺行没有 Create 回退，原独立创建/ACL 错误行为同批通过。
这里的 Core/OIDC 回包是原 fixture，不是在线 Core PEP 或完整业务验收。

事后仅破坏私有副本：65599 恢复 upsert 及 managed Create 调用，exit 1，
实测删除对象被重建、缺行产生 UPDATE 事件、受管最终调用退回 Create；
93001 移除外层事务并跳过空策略替换，exit 1，实测元数据未回滚且撤销策略
仍留数据库。还原后 66012 同集中命令 exit 0，gofmt -l 无输出，正式十三份
源码/生成/锁文件与实际验证输入逐项 cmp 均为 0，正式树无反证改动。

日志目录 `/volumes/data/kailo/tmp/cells-native-merge.Rz8qB5`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `workspace-update-buf-final.log` | `77e36453a009e54447c3daec84d0297ac55d8c26d591aa26f60b7a28ac0dd3e5` | 原两段生成 exit 0 |
| `workspace-update-positive.log` | `1f6e7a11caf73f14a4540eae6fb52957c43475dd7db94871c75cbff0305d88bd` | exit 1，嵌套事务失败 |
| `workspace-update-transaction.log` | `86a58932bcfdd4c02a4fb3702ea6ea8d966ef67e4a51974462bceb24e57cdc5e` | exit 0 |
| `workspace-update-upsert-negative.log` | `3ef7949237dde06af0b12b11c2b7268ac6ddbe682e189193a9cd6e6f89c6a618` | exit 1，复活及回退被拒绝 |
| `workspace-update-atomic-negative.log` | `6f4d6fceb4ab578cc7c7f3921d8e5194101427f63bf332fa3ba0645eeaced2dc` | exit 1，回滚与撤权被拒绝 |
| `workspace-update-restored.log` | `f57edff1b11319ac1254e6e518d4520a92a80f29605a39a83a1896085c903ba9` | exit 0 |

本批仅原生源码与上述窄验证；真实 PostgreSQL/MySQL 并发压测、全部资源 DAO
消费者业务、延迟 worker fresh 授权、线上 Core/Cells 连通、三端与全量门禁均
未在本批验收，没有新镜像、部署或组件上架。SQLite 顺序模拟的读后删除窗口
不写成所有数据库并发已通过；原 ACL 多 RPC 部分完成仍是 UNKNOWN。

## 2026-10-11 原 PEP 可选代次兼容与未闭合延迟删除的安全关闭

本批关联 DD-48/90/94、`07` §4.6/§5.2 与工程准则 9/10/15。基于
`f894a95a3e8acf06938268349e63bca65da2b521` 后的 main 增量，十份源码与
事后检查加本回执；没有新 schema、状态、权限、存储、默认开关或数据库迁移。
固定上游仍为 `c57f02f4962835447df694c63bd0fd8c22bd7baf`：
`scheduler/jobs/userspace/userspace.go::DeleteNodesTask` 原生直接 PutJob，
`scheduler/tasks/runnable.go::RunAction` 消费异步队列并调用原 Action.Run。
本批属于已授权治理改造，不是原页面变更或全部 Cells 功能验收。

### 权威、影响、副作用及异常边界

Core 原 `application_binding_pep.rs` 的 SERVICE_READ 与普通动作响应已经
返回 AE 冻结的可选 `bindingGeneration`；协议 schema 要求正整数。Cells
`common/auth/protocol/action.go` 原来按固定三/四字段拒绝这些真实合法响应。
现在 execute、SOURCE、observe/extract_usage/reconcile 共用闭集校验，兼容
字段缺省，存在时只接受共享 JSON 可精确表示的正整数；null、字符串、布尔、
分数、非正数、不安全数及未知字段仍拒绝。原 AE/operation/target/zed 检查
和每次已认证 HTTP PEP 没有放宽。返回的 token claims 与 Resource 不变，
不会将可选返回值冒充签名 claim，也不从配置回填任务 generation。
原 NativeCell 的 HumanAction authorizeScope 代次校验不经过此函数，未更改。

修好字段门槛不能顺便启用不完整路径：原 `PerformAction` 的受管 delete
可以进入 `DeleteNodesGoverned`，请求内 fresh 检查之后由 broker 延迟执行；
`AuthorizeNativeDeleteDispatch` 之前仅凭原 Task/Job 摘要放行，不能证明
执行时未被撤权。Core `action_token::issue_component_action` 只由原派发
消费；`issue_application_observation` 仅 observe/extract_usage，不允许
替代 execute。当前没有已闭合的、供该 native worker 按同 AE/EE 引用进行
fresh 执行授权的消费者，本批未实现这个跨模块接缝。

因此 `DeleteNodesGoverned` 只读取并精确核对原有 claim，包括原 owner；
没有 claim 返回原 Forbidden，不创建 Task、回收站元数据、子 Job 或事件。
已存在 claim 只回 UNKNOWN，不再次派发。原 request-local 执行 producer
及其失去消费者的分支已删除，独立 `DeleteNodesTask` 仍走原 PutJob/原 ACL。
带 NativeDelete 元数据（包括只有一半或空值）的任务在 Queue 和实际
RunAction 两处拒绝；后者覆盖已经排队的旧任务，不能只靠入队时检查。
独立任务无该上下文时原执行路径保持。

原生 worker 的 Error 只记录本地拒绝，不能证明整个外部动作失败：此前
可能已有部分副作用。既有 `NativeDeleteTerminal` 仍只以全部原 child
Finished、固定摘要及逐节点 ACK 证明成功；错误、部分 ACK、缺 child、
取消或无法读取保持原 UNKNOWN/拒绝，`nativeDeleteObservation` 不映射 FAILED。
历史完成任务的完整证据仍可对账，不删除历史，不盲目重放。没有新增需回收
的状态。Web/Desktop 仍经原管理 BFF；Mobile 没有新增入口或页面承载。

### 实际命令、反证与范围

沿原 `kailo-cells-native-check-lftow7` SDK，镜像
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，
4 CPU / 8 GiB、等额 memory+swap，独立 Data Go build/module 缓存；启动前
原容器只有 sleep，主机 available 35–36 GiB。没有新增容器、并行构建或安装。
私有目录沿原 `.native-cell-reconcile.MHdjoL`；原测试输入中历史未更新的
`task-receipt_test.go` 已从当前 HEAD 精确重新导出，正式该文件没有修改。

环境为 `GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local`；
`CELLS_WORKING_DIR`/`CELLS_DATA_DIR` 指向原私有 Data `.cells-runtime`。
容器内执行 gofmt 及 `go test -mod=readonly -count=1 -v -run`，筛选以下
实际符号：TestAuthorizeActionUsesOriginalBindingPEP、
TestAuthorizeOperationObservesOriginalExecutionWithoutResourceBody、
TestActionPEPConsumesOptionalFrozenGeneration、TestNativeHumanActionUsesOriginalPrivateTransport、
TestResolveRequiresOriginalHostOrigin、TestManagedDeleteOnlyResolvesExistingClaim、
TestNativeDeleteCannotQueueOrRunWithoutDelayedAuthority、TestNativeTaskClaimPrecedesDispatch、
TestNativeDeleteTerminalRequiresOriginalPerNodeAcknowledgements、
TestNativeDeleteAcknowledgementsRemainInOriginalClaimedTask、TestHandler_deduplication。
包范围为 `./common/auth/protocol ./scheduler/jobs/userspace ./scheduler/tasks
./scheduler/jobs/grpc ./gateway/restv2`。

最终 29724 exit 0：上述 11 个顶层检查通过；可选字段检查为 15 场景 × 5
操作，原 Bolt 终态包含 16 场景。HTTP PEP/OIDC 是本地受控响应夹具，不是
真实 Core/SSO；Queue/Run 使用原生产消费者与计数 Action，未删除真实文件。
gateway/restv2 本轮编译通过但输出 `[no tests to run]`，不计 HTTP 删除验收。

失败保留：38802 因缺 CELLS 工作目录尝试写 `-/.config/pydio/cells` exit 1；
补原环境后 33181 exit 0。34224 因删旧 producer 时遗留 execution 引用，
以及旧私有终态检查输入而 exit 1；精确清理并校准输入后 66809 exit 0。
59221 私有反证恢复旧字段拒绝、放行 Queue 与伪造不存在的 claim，exit 1；
69315 去掉 Run 守卫后以 ActionNotFound 捕获，随后 44074 用实际 Action
计数再次反证：`calls=1 err=<nil> Status:Finished` 被拒绝，exit 1。
所有反证只在私有输入，最终恢复后原检查再次 exit 0。

日志目录 `/volumes/data/kailo/tmp/cells-native-merge.Rz8qB5`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `pep-generation-positive.log` | `a03910143f9b9f31ea0abda32567c6ac409f0bb813ff87daa1b3fb7c500e5b31` | 环境失败 exit 1 |
| `pep-generation-environment.log` | `24d825343e1fc1c537a056a94b694d7bd1f72ef93f1134bfc2cc4ca0a9c07271` | exit 0 |
| `delete-delayed-authority-positive.log` | `73821974e5c1320defe5d26934e4c66ea284a5c147ada97d406e702e2ca47bed` | 实现/输入失败 exit 1 |
| `delete-delayed-authority-closure.log` | `05760260d11bc162372785cd8f399b0af004171cf0513350b76ca172904a0504` | exit 0 |
| `pep-delete-negative.log` | `0f27cc7d1280e8f4bba415fc1e34757b113594a2198f6e1dc41c07768e322e64` | 三处反证 exit 1 |
| `delete-run-consumer-negative.log` | `59757ecbb3d3bcfcf79d188d4f3cbed2def4ea23e18a7b7d0178893bc4d19763` | 实际 Run 反证 exit 1 |
| `pep-delete-restored.log` | `f12cf1cc98942f805ebc8afb42bed8860adb77160800ee41c2784e4655f36283` | 恢复后 exit 0 |

本阶段必须同时发布 PEP 兼容与未治理删除关闭，不能只部署解除字段门槛的
版本。未做全量门禁、新镜像、部署、绑定激活、真实三端或多人业务验收。
完整受管删除仍未交付；后续必须闭合同 AE/EE 的延迟 fresh 授权及实际撤权
业务证据后才可恢复新派发，不能持久化 ActionToken 或用观察权限替代写权限。

## 2026-10-11 受管 read/export 在完整核验后交付正文

本批关联 DD-48/90/94、`07` §4.6/§5.2 与工程准则 9/10/15，修正现有
受管读取消费者，不增加协议、持久状态、权限、默认阈值或迁移。固定官方
`c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`gateway/data/gw/gateway-pydio.go::GetObjectNInfo/GetObject` 使用原 io.Pipe
流式读取；本批独立原生读取原样保留，受管读取属于已授权治理差异。

### 权威与完整影响

原 `GetObjectNInfo` 只对同步 Human 与 SERVICE SOURCE 等待完整读取，
已携带原 NativeReadExecution 的 HUMAN/AGENT read/export 却仍先返回
MinIO reader；异步 GetObject 的最后 fresh 拒绝或 ACK 丢失来不及阻止
调用方发送成功头，空文件尤其不能靠读正文触发错误。现在任意非空原
NativeReadExecution 都沿已有同步请求内 buffer，GetObject、原 UUID/ACL
核对、CopyNativeRead 的 claim/running/completion ACK 和最后 PEP 全部
成功后才构造返回 reader，不新增存储或复刻正文权威。

CopyNativeRead 的非枚举正文统一消费原投递 MaxResponseBytes：非正、
溢出边界及已知正文超限在 claim/source open 前拒绝；实际源读取至多
MaxResponseBytes+1，再用原 expectedBytes 精确长度检查拒绝超吐与截断。
这不是新默认数值，受管可读取大小由既有受控投递决定。枚举调用方
`api-lookup.go::Lookup` 与 `api-versions.go::NodeVersions` 的原分支未变。
独立 GetObject/Pipe 不受影响；没有改 Core、四侧契约或三端宿主边界。

原 Task 不明/重入/终态规则保持：open、copy、Close、fresh 或 ACK 任一
失败不返回成功 reader；已有 Task 仍保留供同一执行对账，不能重开源。
最后披露被拒绝或 ACK 丢失前可能已持久化完整读取证据，不删除该证据，
也不把 HTTP 拒绝推断为整个 ExternalExecution FAILED。零字节同样等待
最后 PEP 和 ACK。未新增需要后台回收的状态；正文仅存在请求生命周期。

原 MinIO 固定依赖 `github.com/pydio/minio` 的锁定版本
`v0.0.0-20251127102432-d3b575770589`，
`cmd/object-api-utils.go::NewGetObjectReaderFromReader` 构造失败会调用
cleanup；本消费者传空 ObjectOptions，没有另造 Pipe 补丁。独立提前 Close
与正常读完均实际确认源 Close，受管路径不再创建该 Pipe 协程；不据此声称
所有独立远端阻塞源的取消行为已验收。

### 实际命令与事后反证

复用原 `kailo-cells-native-check-lftow7`，镜像
`sha256:a688600ca24f8a4d3ca77f95b0dd40704a9fc787c826660eb7ba0b641b8b175d`，
4 CPU/8 GiB/等额 memory+swap，独立 Data Go 缓存；启动前容器仅 sleep，
主机 available 35 GiB，load 25。没有新容器、SDK 安装、并发编译或生成。
原私有输入按当前 HEAD 导出 gateway/data，四份本批源码与最终执行输入
逐文件 cmp exit 0。保持 GOPROXY=off、GOSUMDB=off、GOTOOLCHAIN=local
及既有 Data CELLS_WORKING_DIR/CELLS_DATA_DIR。原 SDK gofmt 后执行：

```sh
go test -mod=readonly -count=1 -v -run 'TestGovernedReadCompletesBeforeReturningMinIOReader|TestIndependentReadKeepsStreamingAndClosesSource|TestNativeReadTaskRecordsActualStreamOnce' ./gateway/data/gw ./scheduler/jobs/grpc
```

最终 52163 exit 0，gofmt -l 无输出。原受管 GetObjectNInfo 的 32 场景
覆盖 HUMAN/AGENT × read/export × 0/12 字节 × 合法、版本不符、最后 PEP
拒绝、completion ACK 丢失。合法返回前断言实际 4 次 PEP、3 次 Task 写入
ACK、Finished 与源 Close，再从原 reader 读回精确正文。实际消费原
NativeReadAuthority、UuidClient 与预置原 AccessList 规则，无 skip/admin
旁路；HTTP Core/OIDC、原生树/用户/策略/Job RPC 为受控夹具，不是线上服务。
原 Bolt Task 的 24 场景同时通过，包括源失败、部分正文、Close/ACK 失败、
最后撤权、空文件、超限、重入和原枚举；独立 Pipe 提前关闭及读完通过。

50953 私有反证仅撤回三个生产谓词，两包均 exit 1：8 个 GetObjectNInfo
拒绝场景捕获提前返回成功 reader；原 Bolt 检查捕获超限伪成功及源超吐
越界。随后恢复原三行，最终同批命令退出 0，正式工作树未加入破坏内容。
首轮失败原样保留：35171 新检查误用未导出的 minio.NoLock；53238 引用
未生成 JobServiceStub；随后直接注册服务缺 ClientConnInterface；48153
夹具误用非合同 PEP 路径而被拒绝。均为本轮检查接线错误，按锁定原接口
修正后 62442 的 32 场景通过，再做上述反证/还原，不以失败轮充当通过。

日志均在 `/volumes/data/kailo/tmp/cells-native-merge.Rz8qB5`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `read-disclosure-positive.log` | `19545fc561be4aea3ecaa4c570ef44e25c8722eb0bf9df2ca4321cda2090003b` | exit 1；Bolt 通过，gateway 编译失败 |
| `read-disclosure-consumer.log` | `ffff10dd259c5f1b47b6d99dc66d97ee805bb48fde73fc910d351f3d3d35b42f` | exit 1；Job Stub 不存在 |
| `read-disclosure-gateway.log` | `e1a7a8c35b505e66d32ef914d07b92b6b99ba8050129d887fc87d05d0dcb5954` | exit 1；RPC fixture 接口不符 |
| `read-disclosure-gateway-rpc.log` | `b8f8ed4557e86c5b9e4d4d7c8a2af5a144684f370a5f16ea33b674d2064af9b0` | exit 1；错误 PEP 路径被拒绝 |
| `read-disclosure-native-chain.log` | `3c59b7b31ec431d12fad92759889da2ab5c55cbf93b77fce4e83c81928133916` | exit 0；32 场景及独立流 |
| `read-disclosure-negative.log` | `518c16f30727b6215e4ed9e941526f10b9317a32c1225bf862eb25c0b2e1334a` | exit 1；10 个真实反证失败 |
| `read-disclosure-restored.log` | `6bc38dcb8ef72acdf92a84324fe5f96365b3992b5f7402779da1ca248c99a0c9` | exit 0；同批恢复 |

本批没有运行全量门禁，没有新镜像、部署、组件绑定激活、浏览器下载或
三端验收。它闭合既有受管读取出口，不代表完整 Cells 治理集成已上架，
前节延迟删除 fresh 消费者仍未交付；不借本批恢复未治理写入口。

## 2026-10-11 同步版本写入的不明结果与原生观察

基线 `7ec1b88986836d95ee1e3a5f992f2401ff1f2818`，关联 DD-48/90/94、
`07` §4.6/§5.2 及工程准则 9/10/15。固定上游
`c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`gateway/restv2/api-versions.go::PromoteVersion` 原路由保留；本批修正已授权
治理接入中的结果映射，不改变独立原生上传、版本复制或页面。

四步影响结论：

1. 权威：原 Task 的 Running 仅是执行前落盘标记，不是同步 HTTP 请求结束后
   仍有执行者的证明。`executeNativePromote` 的部分复制、fresh 拒绝、归档或
   清理失败、同 key 重入，都可携带该标记返回；不得伪造 RUNNING 或 FAILED。
2. 影响：只修改 `writeNativeTaskResult` 与 `nativeWriteObservation` 两个既有
   响应消费者；后者同时服务 observe/extract_usage。完整 Finished Task、原
   ContentRevision 与因果散列仍由 `NativeWriteRevision` 校验，成立才披露
   SUCCEEDED/contentReference/contentBytes。无 schema、迁移、状态、RPC 或
   凭据格式变化；不改变 Core/Worker、Web/Desktop/Mobile 调用合同。
3. 副作用：两处均只读已有 receipt，不重发 CopyObject、归档、删除或新 Task。
   残留 Running、Error、缺回执、错因果都返回 UNKNOWN；新鲜授权与原生身份
   校验继续拒绝未授权披露，不把请求本地错误当完整外部动作失败。
4. 边界：空文件完整回执可成功；重复请求只观察同 key，不能重新执行。崩溃、
   部分成功、最后 PEP 拒绝或 ACK 丢失不能合成终态。原观察可在持久 Finished
   receipt 已成立时收敛为成功；若 receipt 从未落盘，此处不能自动补造来源或
   证明失败，只保留 UNKNOWN 给既有外部副作用对账处置。本批没有解决这类
   历史不明任务的自动终结，更不把无超时终结证据写成完整生产验收。

完整受管上传仍关闭：原
`frontend/assets/gui.ajax/res/js/core/http/PydioApi.js::buildPresignedPutUrl`
及 `postPlainTextContent` 走原 PUT；
`gateway/data/hooks/auth-handler.go::ServeHTTP` 消费
`common/auth/native-action.go::AuthorizeNativeDataMutation`，受管 PUT/POST/
DELETE/PATCH 没有相应执行凭证即拒绝，Draft-Mode 不豁免。未引入影子上传或
持久 ActionToken，未把同步版本处理冒充完整上传链闭合。

实现后沿原 SDK `kailo-cells-native-check-lftow7`、4 CPU/8 GiB、等额 swap 上限
运行，独立 Go 缓存与源码位于 Data；执行前只有原 sleep，主机 available
35 GiB、load 18.59。`GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local`，沿原
CELLS_WORKING_DIR/CELLS_DATA_DIR 私有目录。实际命令：

```text
go test -mod=readonly -count=1 -v -run 'TestPromoteResultRequiresTerminalReceipt|TestNativeWriteObservationDoesNotInventActiveExecution|TestNativeWriteTaskRetainsExactIntentAndVersion' ./gateway/restv2 ./scheduler/jobs/rest ./scheduler/jobs/grpc
```

同步响应 helper 7 场景、原 HTTP observe/extract_usage 12 场景通过；后者经原
RouteRegistrar、映射用户、原生策略、精确 ListTasks RPC 及两次 HTTP PEP。
RPC 和 PEP 为受控夹具，不是在线 Core。原 Bolt 持久 receipt 检查同批通过。
partial-copy/fresh-refused 是实际失败出口所携 Task 的响应检查，未执行完整
`executeNativePromote` 的真实存储复制故障注入，不能据此称完整写业务通过。

首次 session 8099 exit 1：HTTP 检查缺原路由上下文，原 policy parser panic；
改走原注册器后 session 59766 exit 0。私有源恢复旧两处 RUNNING 分支，78664
exit 1，准确捕获 3 个同步响应与 2 个 HTTP 观察错误；正式源未受破坏。
恢复后 session 96909 exit 0，三包通过，四文件 gofmt 无输出且与私有源 cmp
一致。日志位于 `/volumes/data/kailo/tmp/cells-native-merge.Rz8qB5/`，分别为
`write-observation-positive.log`、`write-observation-native-route.log`、
`write-observation-negative.log`、`write-observation-restored.log`。

未运行全量门禁、完整组件绑定、真实上传或浏览器业务；没有新镜像、部署、
菜单激活或安装包。现有全局失败与其他组件未交付状态不因本批窄验证改变。

## 2026-10-11 普通单文件下载接回原 HUMAN 固定版本读取

基线 `bfea12442835657e1a8d541805fb0c753de0a931`。关联 DD-48/89/90/94、
`03` §6 HUMAN 同请求 SYNC、`07` §4.6 与 `18` 原生接缝；不是解除完整
FILE_STORAGE release/binding 门禁。固定 Cells 官方来源
`c57f02f4962835447df694c63bd0fd8c22bd7baf`：
`common/service/frontend/bootconf.go::ComputeBootConf`、
`frontend/assets/gui.ajax/res/js/core/http/PydioApi.js::downloadSelection` 和
`common/proto/rest/cellsapi-rest-v2.proto::NodeVersions` 均沿原路径消费。

四步影响结论：

1. 原普通下载走 presigned URL/hidden form，没有固定版本及 read/export 头，
   被已存在的 `PrepareNativeHumanRead`/`NativeHumanReadRequired` 正确拒绝。
   原 `openVersion` 已消费固定版本、请求 key 与 HUMAN 准入，复用它接普通
   单文件按钮，不重写下载页面或另造下载服务。
2. 原 `BootConf.Other` 只投递 `nativeReadRequired:true`，来源为已有
   `services.pydio.rest.n.platform` 的存在性。原 PydioBootstrap 将 Other
   原样装入 Parameters，downloadSelection 实际消费；不输出 binding、身份、
   凭据、权限快照，不作为后端权限或 ACTIVE 证明，无新增运行期/编译期开关。
   未配置的独立实例保留原 BootConf 和原下载调用。
3. 受管单文件从原 REST v2 NodeVersions 读取唯一已发布 IsHead，固定其不透明
   VersionId 传给原 openVersion。元数据使用原当前 native JWT，同源、禁止
   redirect；正文仍由现有 Core 准入、原生 ACL、fresh PEP 与 receipt 决定。
   文件名沿原 node label，媒体类型及原签名参数保留。没有新 token、实体、
   工作流、schema、迁移、自动重试或 latest 回退。
4. 空历史、重复版本、多个 head、draft、未知 IsHead、HTTP 拒绝、跨源、用户/
   UUID/路径/仓库变更均拒绝，不能去独立旧路由重试。选中后版本继续变化时
   仍请求刚冻结的 VersionId；已不存在则由原读取拒绝，不读当前 latest。
   目录和多文件仍未具有完整受管归档消费者，在调用端直接拒绝，不创建 selection
   再走旧下载。此处没有解除普通预览、Range、上传、延迟删除、完整归档门禁。

源码完成后复用原 SDK：Node `kailo-cells-closure-kxbrvt`、Go
`kailo-cells-native-check-lftow7`，均 4 CPU/8 GiB；两个 SDK 原来均仅 sleep，
主机 available 36 GiB、load 8.38。原 Data 私有源码和独立 Go cache，顺序执行，
无新容器、依赖下载或大型构建。实际命令：

```text
node --test --test-name-pattern="governed original single-file download" file-storage/adapter/test/query-revision.test.mjs
go test -mod=readonly -count=1 -v -run TestNativeReadBootHintDoesNotExportDelivery ./common/service/frontend
```

Node 执行实际 PydioApi 原类、元数据 fetch、签名、固定版本 body fetch 与本地
下载消费者，15 子场景/16 tests 通过；包含独立 hidden form 原行为。网络、
DOM、JWT 与 SDK 使用受控夹具，不是浏览器或真实 Core 业务。Go 调用真实
ComputeBootConf，两配置场景证明受管提示有消费者且不导出私有 delivery。
34954 实际 Node=0/Go=0。仅私有源将所选 revision 改成 undefined、boot hint
改成 false 后，44784 实际 Node=1/Go=1，分别捕获完整/later-head 下载退回
未固定版本及服务提示断开。原字节还原后 38627 实际 Node=0/Go=0；Go 格式
检查无输出，正式源码和实际私有输入逐文件核对一致。

完整日志根：
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/native-download.p5qkbC/`。

| 原日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `node-positive.log` | `2224164ae41429e7a0f7f3af75c476ce6d6450bb50825b29968eeeed50b78560` | exit 0 |
| `go-positive.log` | `e63add06ba1f188e35102bbfba8c198fac442f3a3acc5d5e4712177540fafcb1` | exit 0 |
| `node-negative.log` | `c25cb49f7774e23e2b19f5b520e937f1d9ca8d6036adfa5de72edb7ad0180f50` | exit 1 |
| `go-negative.log` | `a0f8666a436e400a51faf30fc35dd7f747c3102efa4bdb8cc0e90c8108f123be` | exit 1 |
| `node-restored.log` | `b420ff5cc34c3cd5ee6ed45abd46fced6dda42af7cb50fc79babb004dd549b9c` | exit 0 |
| `go-restored.log` | `e63add06ba1f188e35102bbfba8c198fac442f3a3acc5d5e4712177540fafcb1` | exit 0 |

本批未跑全量检查、完整绑定 conformance、生产前端打包或实际浏览器下载，
没有镜像、部署、菜单激活或新安装包。原 iframe 精确 CSP 和独立 OIDC 登录
代码未修改；Desktop 跨站 iframe 与 Strict Cookie 的安全会话取得仍未验收，
不通过放宽 Cookie/CSRF、复制平台 Cookie 或共享身份解除这一门禁。

## 2026-10-11 原文本打开消费固定版本 HUMAN read

本批基线 `3b5a589e8b8fba2b4241d485ef1231a9aead45a1`，沿 DD-48/89/90/94、
`03` §6 与前节既有 HUMAN 同请求读取，不增加首传或延迟写合同。固定上游
`c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`frontend/assets/gui.ajax/res/js/core/http/PydioApi.js::getPlainContent`
是 editor.text、editor.codemirror（含 badge）、editor.ckeditor、editor.bnote
和 editor.browser 已有正文入口；不是无调用方辅助函数。

四步影响结论：

1. 原受管安装 getPlainContent 仍发无固定版本、无 HUMAN read 头的 S3 GET，
   被现有正文边界拒绝。复用前批普通下载的原 NodeVersions 唯一 published
   head 选择，固定 VersionId 后向原 S3 路径携带同请求 key 和
   `file_storage.read@v1`，后端仍负责实际身份、scope、准入、PEP 与 receipt。
2. `nativeHeadRevision` 由普通下载和文本读取共同消费；上一批普通下载行为
   与固定版本检查不回退。非敏 boot 提示不变，独立实例原 getObject 保留。
   原节点文件名、text/plain 与 no-cache 参数保留；只在原 contentCallback
   前完成同用户、同 UUID/路径/仓库检查，不改编辑器布局或页面。
3. 查询后 head 变化不改请求 revision；正文未完整取得、服务拒绝、请求异常、
   取流途中换用户或节点变更均不调用 contentCallback，也不重试、fallback
   latest、写 draft 或提交新操作。零字节内容保持有效空字符串，不误作无结果。
4. 正文由已有后端 MaxResponseBytes 有界读取与最终 PEP/ACK 后披露。浏览器
   接受原返回文本，不以 native JWT 或 boot 提示替代治理。保存仍经原
   postPlainTextContent/S3 写入边界拒绝，未开放受管首传、覆盖、归档或延迟删除；
   无新状态、配置、凭据、实体、schema、工作流或迁移。

完整 FILE_STORAGE 上架阻断已沿实际实现核对并交主线：
`contracts/adapter/file_storage.v1/write_input.schema.json` 要求既有持久输入
revision，`adapter/src/write-execution.mjs::executeWrite` 仅调用原 Promote，
`gateway/restv2/native-human-upload.go::platformPromoteVersion` 提交前已要求
真实 draft/owner/location；首次 PUT 仍由 AuthorizeNativeDataMutation 拒绝。
不能先独立上传草稿再宣称受管 write。原 NativeHumanActionResult 只有既有
readAdmission，首传 writer 的通用可信准入和终态闭包另由主线处理。
当前 adapter MCP 只有 node/write/delete 路径，七必选中的完整 share 及
已关闭的新延迟 delete 尚未闭合；没有创建 registration 或强行激活绑定。

实现后经与知识队友协调，确认原 `kailo-cells-closure-kxbrvt` 仅 sleep，
4 CPU/8 GiB、MemorySwap 同额，主机 available 37 GiB、load 7.31，使用原
Data 私有输入，没有另开容器、编译或占用 Rust 缓存。实际命令：

```text
node --test --test-name-pattern="governed original (single-file download|plain-text reader)" file-storage/adapter/test/query-revision.test.mjs
```

正向 28 tests/28 pass、exit 0，含上一批下载 15 子场景和本批文本 11 子场景。
原 PydioApi 类被实际执行，DOM、网络及 SDK 为 fixture；完整文本/零字节/
head 变更、两阶段拒绝、网络失败、部分文本、用户/节点变化及独立 S3 均覆盖。
仅私有源删除 text 完成后的 current 检查，exit 1，准确捕获两个途中切换
仍披露正文的反例；正式源未破坏。恢复原字节后 28/28、exit 0，实际私有
PydioApi 与检查输入同正式两源码 cmp 一致，精确候选 diff --check 通过。

原日志在
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/native-download.p5qkbC/`：

- `text-positive.log`：`54667267dc705b686c12ecab2dbe60629085486e7da5b60a9baaaef8d061723a`，exit 0。
- `text-negative.log`：`5d1f645cd3eb00cd9357edcd63ecde2634155f15414a2e8e8055b1342dbe033e`，exit 1。
- `text-restored.log`：`16dbce86381415ed4e7f11d27dfb2a58d80a998ad745c7f1ac290aaedc6a1d96`，exit 0。

后续同一产物可集中验收原普通单文件下载、固定历史版本下载与文本打开，
但本批没有生产打包、部署、真实浏览器/Core、全量门禁或完整 conformance；
不把源码/VM 夹具通过称为这些业务路径已经在线可用或三组件已上架。

## 2026-10-11 首次字节写入的同一 AE/EE 原生消费者

设计依据为 `635c42a6264081f1ca6f37e74969652a6dcf4d1d` 的 `03`、`07`、
`18` 首字节准入纠正及 DD-48/89/90/94。固定 Cells 官方来源仍为
`c57f02f4962835447df694c63bd0fd8c22bd7baf`；实际接入点是原
`frontend/assets/gui.ajax/res/js/core/http/PydioApi.js::getClient`、
`gateway/data/gw/gateway-pydio.go::PutObject` / `NewMultipartUpload` /
`PutObjectPart` / `CompleteMultipartUpload`、
`common/nodes/version/handler-version.go::PutObject` 和
`data/versions/action-version.go::VersionAction`。不是把既有草稿提升当成首传，
没有先走未经治理的独立上传，也没有复制文件正文到 Core。

四步影响结论：

1. 原 write 合同只有既有 ContentReference；本批在同一 FILE_STORAGE write
   输入扩展原生 intent 元数据，原旧输入保留。Core 使用已经准入并派发的
   HUMAN ActionExecution/ExternalExecution，原 ComponentTaskWorkflow 和
   原生 Job/Task 等待首字节；writer 凭原冻结三引用在同请求重新取得短期
   ActionToken，不新建执行或续签权威、不在 Task/history 持久化短令牌。
2. 原生 Prepare/Observe 服务仍验证独立 HUMAN 会话、原 scope 与 CSRF；
   用户不能用 body 指定可信 actor、代次或扩大期限。binding/generation
   对照原 AE/EE 冻结值，安全停用与撤权拒绝新字节；不能用当前版本替换旧
   执行的冻结版本。首字节期限来自原服务器配置且受执行准入期限约束。
3. S3 原签名与 HUMAN cookie 之后才消费 writer admission；每个实际字节
   请求仍核原资源 ACL、冻结节点、fresh PEP、单次 Task claim 和不可变
   Version ACK。UI 在首个 await 前领取同一 intent 的请求槽，不能由并发
   SDK 回调重发同一字节请求；未知结果只观察原任务，不重新发 execute。
4. 空文件也必须最终 fresh/ACK；部分写入、取消、撤权、失联 ACK、过期及
   不完整 Version 均不渲染成功或确定失败。无可证明终态的原 Task 保留
   UNKNOWN，沿原 EE observe/对账，不重派发。独立实例原上传不改治理方式。

Bolt/Mongo 变更是这条真实写路径的必要消费者：原 S3
`claimNativeUpload → JobService.PutTask → MergeNativeUploadStep` 必须在各自
原 DAO 事务内合并单步 claim；binding 截止枚举同时识别派生 upload Job，
否则并发分片会覆盖彼此或停用后仍可领取新字节。它们不增加平台实体或
第二任务账本；没有从旧无归属任务猜出当前 generation。Mongo 真实后端
并发未验证，不能将 Bolt 或纯函数检查外推到 Mongo。

Core 锁序沿原消费者核对：writer 先锁原 AE（FOR UPDATE），再读锁 EE 与
冻结投影；原 `application_execution::record_observation` / usage 也按
AE→EE，`application_action::finish` 先锁 AE。取消先锁自己的 control AE，
再核原 AE，而 writer 不反向请求 control AE；取消事务提交后才发送
Temporal request_cancel。evaluate/check_quota 的额外 pool 读取为普通
SELECT，Temporal 只查询执行与取消 history。此源码核对不是实际 PostgreSQL
并发/连接池饱和验收；持锁期间远端不可达仍按原限时失败，不声明零等待。

额度边界明确保留：既有 NONE 不查计量，CHECK 只读取原 OpenMeter
entitlement/credit 并前后核绑定，不分配或重复扣减 AE reservation；
STRICT 当前仍以 CapabilityBlocked 拒绝。因此本批不宣称 STRICT 预留、
结算或其并发耗尽已交付，也不另造补偿余额。

当前源码和隔离验证不是部署：没有以本批生成镜像、打开组件菜单、激活
binding 或通过完整 FILE_STORAGE release conformance。新延迟删除仍关闭；
真实浏览器首次上传/下载、iframe 登录刷新和跨站会话均不由本批 fixture
代替。最终验证命令、失败和正反恢复结果在本节继续如实记录。

实际已运行证据与边界：

- 原受限 SDK 的联合四侧生成退出 0；隔离 Core 原 `cargo check --locked
  --offline -p platform-core` 退出 0，`report_tests::binding_` 2/2、原
  contracts roundtrip 51/51。该 Rust 输入早于本批发现的 Unix expiry→
  RFC3339 毫秒转换修正，不能声称最终 expiry 单元已经运行。
- 早期隔离 Go 契约 roundtrip 退出 0、TypeScript 57/57、Dart 51/51；
  这些历史结果不能证明后续 Admission expiry 的四侧一致性。保留 Go
  私有输入缺 go.mod、Dart 缺原导出文件及日期拼写不一致失败。后续原
  Go 检查再次检出 `format:date-time` 导致 `.000Z` 被改写；该声明违反
  `contracts/README.md` §1。最终按原契约子集改为普通 string 与 RFC3339
  说明，原样本不改、期待不归一化；Go writer 仍实际调用 RFC3339Nano
  解析并拒绝非法或已过期值。此修正后 native-only 四侧各 1 项通过，
  Go 私有移除 expiresAt JSON tag 捕获失败，恢复后同一用例通过。
- 原 PydioApi 实际 VM 消费者 59/59；仅私有源恢复 await 之后才设置
  dispatched 的旧顺序，并发两回调断言失败、exit 1；还原后 59/59、exit 0。
  此网络/SDK/DOM 均为 fixture，不是浏览器上传。完整 Node 尝试实际
  718 pass/41 fail，缺既有 MCP/xml2js 依赖等原失败保留，不记全套通过。
- 原 S3 消费者隔离 fixture 集成检查使用同一既有
  `kailo-cells-native-check-lftow7`（4 CPU/8 GiB、等额 memory+swap、UID 1000，
  原独立 Data Go 缓存），没有新环境或重建基础设施。命令为
  `go test ./gateway/data/gw -run TestNativeUploadS3RequiresImmutableVersionAndTaskAcknowledgement -count=1 -v`。
  72999 实际 exit 1：检查引用不存在的 JobServiceStub，业务断言未执行；
  改为原 gRPC ClientConn fixture 后 56364 自然 exit 1：0 字节正向进入
  原 ancestors 消费时，fixture BranchInfo 缺 Workspace，发生 panic。
  已在正式检查源码补齐原上下文；主机维护禁止新增检查，尚未复验。
  56364 不是维护强停，不抹去这次失败。远端存储/Core 本来就是 fixture，
  即使后续通过也只能证明原消费者隔离集成，不能称已部署端到端。

原日志根为 `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/` 下
`first-byte-core.09N6oV`、`first-byte-gen.UjVpJs` 和 `first-byte-node.6Ifsfd`；
S3 原日志为
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/first-byte-s3.log`
及同目录 `first-byte-s3-restored.log`。正式工作树不破坏，原日志保留。

交叉复核检出的原发布窗口：原 VersionAction 用
`SHA256([task.ID, NativeVersionActionID, nativeNodeUUID])` 持久化确定性
VersionId，能定位同一上传，但不足以证明版本策略 prune 与原 draft 清理
都完成。原 StoreVersion 先落版本、删除旧版本元数据，再在响应返回
PruneVersions；随后 gateway 的最终 Task 回执存在崩溃窗。不能仅凭
HeadVersion 命中改成 SUCCEEDED，也不能重跑 PromoteRevision。

同批源码现已接入原生恢复消费者。维护解除后正用原受限 SDK 验证下列
增量；未取得终态的检查不沿用前面的 Rust/Node 通过数，也不解除发布阻断：

- `scheduler/jobs/native-upload-publication.go` 在原 Task output 中保留
  完整冻结 node/draft/published/prune 引用，没有短令牌、正文、第二任务表
  或新平台状态。原 DAO 继续拒绝丢弃已写的 output。发布者先取得此原
  PutTask 的确切 ACK，原 CreateVersion 才返回复制目标；丢失 ACK 不复制。
- `data/versions/grpc/native-upload-publication.go` 复用原版本策略计算，
  在复制前通过原 Version DAO 取得有界完整快照，读取/游标/解码失败不当作
  完整 EOF。StoreVersion 只消费同一已经持久化的 plan，不能事后补造目标。
  新 `PublishDraftUpload` 与原 draft 截止栅栏共用 Bolt 写事务／Mongo session
  事务；Mongo 先写同一个原 reservation document，不能靠快照读避开
  与 cleanup 的写冲突。插入冲突整体拒绝，不通过重试发布弥补未知 ACK。
  独立原 StoreVersion 不改变，Mongo 实际后端事务仍未验收。
- `gateway/data/gw/native-upload.go` 在原 PromoteRevision、prune、draft
  清理和版本读回后重读原 Task，消费已经持久化的同一 plan，再保存最终
  NativeVersionResult/NativeUploadContent。不能拿旧内存 Task 覆盖新证据。
- 原 `PruneDraftUploads` 到期扫描保留 native JobID/TaskID，截止后只清理
  同一 plan 中确切的原 native 对象并读回已经发布的不可变版本，补同一
  Task 终态 ACK；不调用上传、Promote、StoreVersion 或新平台准入。先前
  原生删除 ACK 失联仍可按同一引用再核清理；已持久化 Finished 的历史
  Task 不因后来正常版本策略删掉旧发布版本而倒退为 UNKNOWN。
- 扫描时间、批量和请求期限复用既有 draftUploads 配置及原冻结 deadline，
  不从当前 binding generation 猜测旧任务归属；原 Job 元数据必须核对
  原冻结 binding/generation。每次失败保留原 row/location，公平排序在
  后续 sweep 再读同一对象，不创建另一个执行。
- plan 已落而复制／发布未完成时，先清已 fence 的原 draft；确切
  VersionNotFound 时再回收 plan 中未发布的不可变复制体。不能把 plan
  存在当作发布成功，也不能因 published 缺失反复提前返回而永久留住 bytes。

仍无法自动认定终态的边界：没有发布 plan、发布版本缺失/与冻结值冲突，
或只有部分实际副作用时，保留 UNKNOWN；到期暂存 bytes 仍沿原截止
清理，原 Task.TriggerOwner 收到原 StatusMessage 对账提示，原 cleaner
readiness 保持失败并阻止新 staging。该提示不是已经完成人工处置的证据，
也没有伪造 FAILED/SUCCEEDED 或允许新上传来覆盖旧结果。对这些无法补证
的历史任务，完整人工终结处置仍未验收；完整首传交付不能标记通过。

维护期间只写入原 jobs/DAO/S3 检查用例，未运行：空／非空 publication
plan 先于终态、同一 terminal 重读、cleanup fence 拒绝迟到发布、有界
快照失败，以及 S3 发布 plan ACK 失联。S3 远端 Version fixture 同步模拟
原持久 plan ACK，不能用该 fixture 证明原 Version DAO 或已部署 Core。

维护后集中原 Go 检查首轮 17406 实际 exit 1：jobs 的 4 项及原草稿
清理／取消检查通过；DAO 原包需要 kv/storage 标签，未投递而 setup
失败；旧 grpc FirstWriter 夹具缺可信 Job/Task 被新原生门禁拒绝；S3
夹具缺 Role/ACL 远端及准确版本对象查询，未形成成功上传。原日志
`first-byte-final.LPEm6u/native-go-positive.log` 保留。修正只补真实
原消费者所需 fixture，额外覆盖缺 Task 拒绝，不放宽生产授权。
后续同一 5 包以 `-tags=kv` 集中复验，并包含原清理入口的 6 个恢复
场景及传入旧 now、真实 deadline 已过且未 sweep 时拒绝发布的 DAO
断言；未获终态前仍不计通过。Mongo 没有独立 DSN，不能将跳过计为通过。

主线 Projects 合入后，本批私有候选在
`8e3ac789d6ceb12f23ba04f88a6dce8736a5160b` 上重放；原联合
`tools/gen.sh` 35917 exit 0，4 侧同时保留 Projects 枚举和上传字段，
两份 Dart 词条与该主线逐字 cmp 通过，未吸入后续词条。首次 79559
遗漏原 npm cache 投递，ENOTCACHED exit 1 如实保留；恢复既有
`/cache/npm` 且 offline 后通过，没有新装依赖。四侧 native-only
命令及正反恢复日志见 `first-byte-final-gen.NOi7VK/native-roundtrip-receipt.md`；
这些仍是隔离契约证据，不是实际服务部署或原生浏览器上传证据。

原五包复验 `63927` 的实际源码树为
`acfdae34910ac33124566b1927c99c7e7674fd97`，整体 exit 1；命令是
`go test -tags=kv ./scheduler/jobs ./data/versions ./data/versions/dao ./data/versions/grpc ./gateway/data/gw -run 'NativeUpload|NativeDraft|KailoNativeDraft' -count=1 -v`。
jobs、versions、DAO、grpc 四包通过；DAO 的 Bolt 检查 450.526 秒，
grpc 453.196 秒。六个原 Task 恢复场景、旧 now 跨 deadline 拒绝发布、
空／非空 FirstWriter、丢失 object/reservation ACK、缺 cleaner/Task
拒绝均实际通过。Mongo 无 DSN，没有执行其真实后端事务验收。
准确日志是 `first-byte-final.LPEm6u/native-go-restored.log`，不与
17406 的 `native-go-positive.log` 混用。

S3 的 0／12 字节成功路径仍因 `Object not found: io/live/file.txt`
失败，十个拒绝子例不能证明到达各自 ACK 注入点，也不能抵消正向失败。
原对象 fixture 的 GET 只有 Size，丢失已存 Key/ETag，原版本复制消费者
因此拒绝；同一 fixture 的原索引写端也缺失。已补齐远端 fixture 并强化
plan-before-copy、发布后拒绝与终态 ACK 丢失的实际阶段断言；这些后补
断言不在 acfdae 输入中，尚未执行，不沿用上述通过结果。

最终 RFC3339 expiry 和来源目录 selector 的原 Core 检查集中在同一
受限 SDK／原 rust-target 执行；格式后联合输入树为
`51372417758dfcfc90bbe727e30eaceda038a33f`，上传候选之外只加入已独立
归属的 `platform_views.rs` selector，提交仍分开。原句柄 `15114`
实际 exit 0；先运行
`cargo test --locked --offline -p platform-core native_writer_expiry_serializes_verified_unix_claim_as_contract_datetime -- --nocapture`
得到 1 passed、435 filtered，再运行
`cargo test --locked --offline -p platform-core discovery_channel_selector_keeps_legacy_cursor_and_rejects_non_uuid -- --nocapture`
得到 1 passed、435 filtered，第二段复用同一编译产物。日志为
`first-byte-final.LPEm6u/core-expiry-final.log` 和
`first-byte-final.LPEm6u/core-selector-final.log`；其他集成用例被过滤，
不是实际 PostgreSQL 业务集成通过。

S3 补全对象证据后，`1572` 在原 StoreVersion 前实际检出 `conflict`
并 exit 1；六个加强的阶段断言同时指出旧拒绝检查尚未达到注入点。
原因是原 `FlatStorageHandler.postCreate` 在复制完成后修改目标节点
MTime/Size/ETag，而 `VersionAction` 的 targetNode 直接别名已经冻结的
`resp.Version.Location`。同批修正仅让原复制消费者使用节点副本，
待存 Version 也独立 clone；受管分支验证实际目标除索引统计之外的完整
原生身份／路由／内容哈希没有改变，并保留复制前冻结 Location，不能
把后来可变统计写进冻结 plan。独立原事件版本行为保留，StoreVersion
与 Task 仍要求完整精确 ACK，没有弱化比对来获得通过。

最终 Go 生产输入树为
`b84a03134528c823a1ed62d930cb3bb0ebccecca`。原命令
`go test -tags=kv ./data/versions ./gateway/data/gw -run 'TestVersionActionRequiresExactNativePersistence|TestNativeUploadS3RequiresImmutableVersionAndTaskAcknowledgement' -count=1 -v`
在同一原 SDK／独立 Data 缓存执行：`66542` exit 0，原 VersionAction
29 个场景与 S3 12 个场景通过，包括 0／12 字节真实不可变对象读回、
部分字节、复制前 plan ACK 丢失、版本 ACK 丢失、任务终态 ACK 丢失与
发布后 fresh 撤权；每个后期拒绝用例同时核已实际达到注入阶段。
日志 `first-byte-final.LPEm6u/gateway-location-restored.log`。

只在私有副本进行两次破坏：`22614` 恢复可变 Location 别名，两个成功
路径均因 conflict 失败，exit 1；还原后 `93619` 将最终 Task 精确 ACK
误改为仅检查非 nil，两个丢失终态 ACK 场景报
`uncertain upload returned S3 success`，exit 1。两处原样还原且与正式
源码 cmp 通过后，`40413` 重跑同一双包命令，29＋12 场景再次通过，
exit 0。日志分别为 `gateway-location-mutation.log`、
`gateway-ack-mutation.log`、`gateway-final-restored.log`，均在同一
`first-byte-final.LPEm6u` 下。正式工作树没有破坏，未重复慢速 DAO 检查。

上述验证补齐的是原生消费者隔离集成及实际拒绝阶段证据。远端 Core、
对象存储和部分 RPC 仍是 fixture；原 logger 无已挂载服务输出驱动的
警告保留，不声称日志服务完成验收。没有运行本批全量发布门禁、生成
本批镜像或执行浏览器上传，未开启组件 binding；Mongo、真实跨服务
conformance、审批／额度及无证据历史任务人工终结边界仍按前述保留。

合批全量输入同时更新原 CI 的唯一 `DESIGN_COMMIT` 至
`635c42a6264081f1ca6f37e74969652a6dcf4d1d`。该设计提交只把已审的
三文件五行首字节准入修订接到原 design-authority 历史，已经普通 push；
外层当前工作分支的 `87625ff0e45ae1d89567105591f60da04b98e8d8`
不是 CI 冻结分支，不混入其余工作树改动。原 `check.sh` 和 CI 都读取
这一 pin 导出 `.design`；不改变设计语义、数据格式、工作流或运行期
权限。旧 pin 未包含本次 writer 接缝，不能用旧设计检查宣称本批收口。
设计导出失败仍使检查失败，不回退旧版本；本变更无数据库迁移或
运行期副作用，新增异常状态无适用对象。

### 首字节合批完整检查与原上传交互纠偏（2026-10-11）

上段截至定向检查的记录之后，实际执行了唯一一次合批全量：
`CHECK_SOURCE_REF=70aa0fa8335dfb6e0080de1b9c99cfccfae14ee6
./tools/check.sh --full`。原句柄 `65362` 完成全部步骤及外层清理后
真实 exit 1；日志 `/volumes/data/kailo/tmp/tmp.Mw5QBQUPRG.check.log`。
执行配置为 8 CPU、16 GiB、memory+swap 同为 16 GiB、host 网络；
`TMPDIR=/volumes/data/kailo/tmp`、缓存为原
`/volumes/data/kailo/check-cache`。启动前无 Cargo／Go 编译，available
约 36 GiB；实际容器限额由原入口回读，固定检查镜像为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。

全量结果按原因保留，不用后续窄验覆盖原失败：

- 本批 Clippy 失败：`application_native_execution.rs` 的测试模块位于
  `authorize` 前，触发 `items_after_test_module`。只将原测试模块移到
  文件末尾，生产与测试语义不变，不加 `allow`。
- 已提交 Projects 检查夹具类型失败：`project-inbox.test.tsx` 两处把
  普通 query 函数赋给推断为 Mock 的 host.query。只显式声明既有
  `ProjectsHost`，独立 query 仍保留 Mock 断言，不改产品实现。
- 产物来源门禁失败 11 项：Relay、Desktop、Wren UI／AI／engine、
  Cells adapter／service、WeKnora adapter／service、AgentGateway、Web。
  已有镜像不对应当前源码，未修改 digest 或来源声明冒充重建。
- cargo fmt、Go／TypeScript／Dart 静态检查、四侧生成同步、304 个 schema
  兼容、Cargo／Go／Dart 测试、Workflow replay、追溯、安全与文档步骤通过；
  TS contracts 为 59／59，platform 测试因上述类型错误未启动。
- 未投递 DATABASE_URL 的实际迁移演练、未投递部署 `.env` 的运行配置
  预检为 SKIP；gitleaks 未安装，只通过内置秘密扫描。

Clippy 修正的精确代码树为
`a45a17b92824f466293c2de4f5c2648b18913ad8`。原 full 结束后，复用
`kailo-cells-closure-kxbrvt` 的 4 CPU／8 GiB／等额 swap 与 Data 缓存，
在独立 `first-byte-clippy.88zGwj` 固定输入执行
`cargo clippy --locked --offline -p platform-core --all-targets -- -D warnings`。
首次导出漏原 build.rs 的 ExtMcp proto、第二次漏原 include_str 的
capabilities.yaml，分别 exit 101；这是本次投递错误，不归产品错误。
补齐同一固定树的真实依赖后，原句柄 `4959` exit 0，43.82 秒。
三份日志依次为 `first-byte-final.LPEm6u/core-clippy-fixed.log`、
`core-clippy-complete-input.log`、`core-clippy-restored.log`，前两份未删除。

固定官方 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
`frontend/assets/uploader.html/res/js/model/UploadItem.js::_doPause/_doResume`
原本消费 `frontend/assets/gui.ajax/res/js/core/http/awsLoader.js` 的
`ManagedMultipart.pause/resume`。原版对照发现受管上传返回句柄漏转发该
能力，现仅在 PydioApi.uploadNativeFile 的 multipart 分支委托原 manager，
并保留 prepare 期间暂停；单 PUT 仍不能暂停。没有新传输、授权或队列权威；
取消后恢复不重新派发，prepare 失败仍 UNKNOWN。布局及独立原生分支不变。

实现后沿原 query-revision 检查消费真实 UploadItem、PydioApi 与
ManagedMultipart：最终 295／295 正向及还原均 exit 0；私有破坏暂停
委托后实际派发未停止、破坏拒绝签名的禁止跳转后实际 href 改变，两类
检查均 exit 1。初次 282 pass／13 fail 保留：旧签名夹具初始 URL 非空却
断言空串；按实际不跳转不变式改为记录初始 href 严格比较，不改签名实现。
同一旧断言在未修改基线 a45 上复现；最终修复树
`511853b694c1f1d04005ecbea768752ce8317b69` 的两文件已与检查输入 cmp。
命令为原 Node `--test` 的 native consumer 过滤，日志在
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/upload-pause.TYA1KO/`：
`native-final-positive.log`、`pause-mutation.log`、`signing-mutation.log`、
`native-final-restored.log`。远端 AWS 仍为 fixture，未声明真实浏览器上传。

Projects 唯一类型修复在固定 main
`89c3aa14ef2e2e69ff4420172ae72782cee9a089` 上实跑原
`tsc --noEmit -p tsconfig.test.json` exit 0、project-inbox 14／14 exit 0，
再跑 platform 全套 67 文件 1180 项全部通过；没有放宽 theme 超时。
日志为 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/` 下
`project-inbox-typecheck.bHDpFR/tsc-correct-dependencies.log`、`vitest.log`、
`vitest-platform-complete-input.log`；其两次缺依赖／输入错误记录保留。

最终合批仅收上述精确源码与证据，不再次运行全量。全量 exit 1 仍成立；
定向通过不解除产物来源、真实数据库、Mongo、跨服务 conformance、完整
审批／额度、真实原生上传及组件绑定准入门禁。本批未构建发布镜像、未部署，
没有新页面截图、Windows／Mobile 安装包或强制激活菜单。

### 2026-10-11 原分享链接撤销的受管调用链

本批只闭合已有链接的 REVOKE 用户操作，不把它声明为完整 share 能力，
不激活要求七项能力全部成立的 FILE_STORAGE release 或 binding。创建／更新
分享与受管延迟删除仍关闭；独立实例的原分享行为保留。

动手前的四项结论：

1. 权威是 `.design/07` 的必选 `file_storage.share@v1`、`.design/03`
   的 Resource／scope 授权和 `.design/18` 的原生动作治理。复用固定 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `/volumes/kailo/.references/cells/idm/share/client.go::DeleteLink` 原三步删除：分享文档、隐藏
   用户、分享 Workspace；不删除文件正文，不以 grant_read 替代分享。
2. 影响沿原 LinkModel → 分享 REST → Core 既有 componentAction／AE／EE →
   adapter HTTP／MCP → 原 DeleteLink；原 Job／Task 持久冻结 binding 代次、
   AE／EE／key、原文档主键、隐藏用户和 Workspace／roots。复用原 Jobs DAO
   的 create-only 和 binding fence；没有新增平台状态、执行账本或持久 token。
3. 受管 GET 的 binding header 只是页面接缝提示，不是权限权威。缺 header
   可进入独立原调用，但受管实例的 DELETE 后端仍拒绝没有可信证明的请求。
   首次派发前校验 actor、Tenant、资源根与全部分享 roots；原三次副作用前各做
   同一冻结执行的 fresh PEP。原 Workspace policy 读取错误不能被吞成不存在。
4. 重复请求／刷新／丢 ACK 只读取同一原 Task，不重放 DeleteLink、不另发 AE。
   原多 RPC 不构成分布式事务；部分删除、fresh 拒绝、读取错误或终态 ACK
   缺失保持 UNKNOWN。仅有首次派发记录且三个冻结原生引用均由权威读取确认
   移除，才归档原 Task 的精确 receipt。终态同时验证冻结 AE／EE／三引用、
   StartTime、EndTime 顺序及非未来时间；无归属的 404 不能证明成功。不能证实
   的任务留在既有外部副作用对账路径，不自动重派发或伪造零用量。

源码不改变原分享页面布局。原 LinkModel 继续保留原链接直到 Core 确认成功；
浏览器只持久请求键及非秘密 binding 域，沿既有 JWT／CSRF／同源通道，账号或
仓库切换拒绝继续。`action.share` 使用已有锁中的 uuid4 1.1.4，不新增版本。
新 share 输入／输出 schema 是该已有动作的线协议消费，本批四侧生成和往返
结果仅在实际运行后追加；未把未生成内容称为完成。

原隔离 Go 输入为
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-share-revoke.obZu8o`，
复用原 4 CPU／8 GiB、UID 1000 SDK 和独立 Data module/build 缓存，
`GOPROXY=off GOSUMDB=off`。原句柄 67158 exit 0，日志
`native-share-positive.log`：idm/share 1.728s，原 Bolt DAO 17.962s；其他六包
无命中／无测试文件，只计编译通过。Mongo 没有隔离 DSN、未运行，不能计通过。

交叉复核发现首次归档跨秒时，提前记录 lastObservedAt 会早于稍后 Task receipt
的 terminalAt。原 NativeShareExecution 改为 archive 和最后 fresh 完成后统一
记录观察时间；不放宽 adapter 的时序验证。新增原函数实际 observe 消费用例，
经过 HTTP PEP、原 SERVICE→native actor、原三引用读回和 Task ACK，令一次
原生查询跨秒，验证三次 PEP、一次 receipt 写入、零删除重放以及时间顺序。
该用例首次句柄 38401 exit 1：夹具未使用原 RouteRegistrar，HTTPPolicyRequest
因缺 resolved URI panic。补原路由 context，不改变生产鉴权容错，93943
exit 0（2.460s）。私有真实源码移除 fresh、首派发时间检查并还原旧提前观察
时间，5548 exit 1，分别捕获未授权删除、缺 StartTime／逆序和跨秒时序错误。
生产原字节 cmp 0 还原后 17446 exit 0（1.959s）。未重复原 DAO 的完整检查。
新增日志依次为 `native-share-final-positive.log`（路由夹具失败）、
`native-share-routed-positive.log`、`native-share-mutation.log`、
`native-share-restored.log`。命令为：

```sh
go test -tags=kv -mod=readonly -count=1 -v -run 'TestNativeShare|TestDAO_NativeShare' \
  ./common/auth ./idm/share ./idm/share/rest ./idm/workspace/grpc \
  ./scheduler/jobs ./scheduler/jobs/grpc ./scheduler/jobs/rest ./scheduler/jobs/dao
# 时序修正和私有反证／恢复仅复验原消费者包，不重复 DAO
go test -tags=kv -mod=readonly -count=1 -v -run TestNativeShare ./idm/share
```

原 Node 输入为
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/share-native-node.nzkE5h`。
首次句柄 46672 exit 1：24 项计数中 21 pass／3 fail，两个 MCP 子例缺
`@modelcontextprotocol/sdk`，父项一并失败；其 HTTP／原页面／观察拒绝用例
通过不抵消 MCP 环境失败。按此前本文件原回执定位现成
`delete-governed.hb2FHx/file-storage/adapter/node_modules`，确认 SDK 1.26.0、
xml2js 0.6.2 及 package-lock 与本批 cmp 0 后，只读复用到独立 Data 输入；
没有下载或安装。修正环境后的同目标句柄 13887 exit 0，24／24；真实 MCP
Client transport 的 HUMAN／AGENT init/call 与 HTTP 均运行。私有生产源码移除
EE 校验和已有浏览器意图读取后，原目标 exit 1，捕获 missing-ee 返回 200
以及丢 ACK 后再次 GET 的两个真实错误；不是改 fixture 制造拒绝。原字节恢复、
两个文件与正式源码 cmp 0 后同目标再次 exit 0，24／24。日志依次为
`share-positive.log`（首次缺依赖）、`share-dependencies-positive.log`、
`share-mutation.log`、`share-restored.log`。命令为：

```sh
node --test --test-name-pattern='native share|original share revoke|share pending|independent share' \
  file-storage/adapter/test/query-revision.test.mjs file-storage/adapter/test/native-share.test.mjs
```

上述均是原消费者加隔离服务 fixture，不是在线 Core→Cells 浏览器验收。
本批未部署、未截图、未运行 full，不解除原产物来源及完整 conformance 门禁。

契约私有输入在
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/share-contract-gen.TrupYU`，
基于已提交 `fc6ff4c3c15a8d1b3343320eb719cf95afe4da8d` 的 contracts／原
gen 工具／i18n，只叠本批两 schema 与样例，未收公共 dirty。准备提取时两次
命令错误（未指定 Git 根、请求未跟踪的 Dart lock）均在验证前退出，随后按
真实已跟踪输入纠正；没有据此判断产品成败。原 closure SDK 4 CPU／8 GiB、
UID 1000、Data 缓存，原 `tools/gen.sh` 32192 exit 0。复核生成物发现未经
命名的 share.operation 枚举使旧 Pulse Operation 改名；虽三侧往返 19088
各一项通过，不把它作为旧消费者兼容证明。只为新枚举明确 schema title
`FileStorageShareOperation`，不改线格式；66003 再生成 exit 0，四侧仅新增
61／24／26／48 行，无旧类型删除或改名。两份生成 Dart 词条对 HEAD cmp 0。

最终命名输入 69527：Go／TypeScript／Dart 各一项原往返 exit 0；原 Go
生成物 nativeShareRef JSON tag 私有破坏为 `-`，29024 exit 1，确实捕获原
引用丢失；还原后 68117 exit 0。原始样例未改以迁就结果。日志为
`share-gen.log`、`share-gen-named.log`、`share-*-roundtrip.log`、
`share-*-final.log`、`share-go-mutation.log`、`share-go-restored.log`。
命令沿原入口：

```sh
npm_config_cache=/cache/npm npm_config_offline=true bash tools/gen.sh
# worker/
GOPROXY=off GOSUMDB=off go test -mod=readonly ./internal/contracts -run '^TestFileStorageShareRoundtrip$' -count=1 -v
# client-kit/ts/contracts/
node --test --experimental-strip-types --test-name-pattern='file storage share preserves' test/roundtrip.test.ts
# client-kit/dart/（依赖只从原 /cache/pub 离线解析）
dart pub get --offline
dart test test/roundtrip_test.dart --name 'file storage share preserves'
```

Rust 补验使用同一 closure SDK 的原 Cargo 环境和 `/cache/rust-target`，
显式 `CARGO_INCREMENTAL=0`、`-j16`；当时原 incremental 清理仍在进行，
没有另建 target 或安装依赖。私有输入
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/share-contract-rust.9hVClp`
取已提交 `562156ae7f12953e3eea61305fe282ae98b6c416` 原 Core／Buzz manifests
及依赖源码，只叠本批已生成 Rust、原往返检查和样例。43231 因投递漏原 Buzz
manifest exit 101；11596 因误投 `CARGO_HOME=/cache/cargo`、离线找不到 png
exit 101，二者均未执行用例。补齐原路径并恢复 SDK 本身
`CARGO_HOME=/usr/local/cargo`（registry／git 原挂载均在 Data）后，44199
真实 exit 0：1 passed、51 filtered；日志 `share-rust-original-cache.log`。

```sh
CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=16 CARGO_TARGET_DIR=/cache/rust-target \
  cargo test --offline -j16 -p contracts --test roundtrip \
  file_storage_share_preserves_exact_native_reference -- --exact
```

四侧本批原往返至此均实际通过。TS 此处是原运行期往返，不等于 tsc 全量
通过；历史 contracts tag 兼容门禁与本批 full 未运行。生成物只进入私有
候选，未覆盖其他人的正式生成物改动。

#### 首次撤销原消费者与持久派发补验

补验只扩原 `idm/share/native-link_test.go`，不改产品接口。真实调用
`NativeShareExecution(execute)` → 原 `NewNativeShareTask` →
`boltdb.OpenPool`／Jobs Bolt `ClaimTask`、`PutTask` → 原 `DeleteLink` 的
文档、隐藏用户、工作区三步删除 → 原 `archiveNativeShare`／终态校验。
每步 RPC 入口都回读原 Bolt Task，验证首派发 claim、Running／StartTime、
精确原生引用、原生用户、先后次序和 fresh 次数；缺原源 ACL 时不写任务。
文档、用户、工作区和 PEP 是有状态隔离 RPC／HTTP 夹具，不是线上服务，
因此本项不是线上三服务或浏览器端到端验收。原 NativeShareExecution、
DeleteLink、UUID ACL router 和 Bolt DAO 是实际生产消费者，不以固定返回
成功替代这些消费者。

原 SDK／Data Go 缓存和日志仍在 `.native-share-revoke.obZu8o`。58038
`native-share-first-execute.log` exit 1：新增夹具误用 Storage.Close 和新版
泛型 DocStore stream，按原 `boltdb.DB.Close`、原生成 stream 接口修正。
18146 `native-share-first-execute-routed.log` exit 0，14 分支全部通过，
522.233 秒：完整成功、claim／dispatch ACK 丢失、文档／用户／工作区
各自错误及 ACK 丢失、终态 ACK 丢失、三个删除步骤前 fresh 拒绝、缺源 ACL。
同 key 重试只观察，只有三个原引用均已确定移除才允许写终态；工作区删除
ACK 丢失后可依据原引用对账归档，终态 ACK 丢失则读取已持久 receipt。
原 router 的可选 draft 展示查询因夹具未注册 RoleService 打印 no-registry，
没有把它算作授权通过，也没有以此推断实际 I/O 延迟原因或重启检查。

末版新增 RPC 入口 attempt 断言，连被原 fence 拒绝的重派尝试也须捕获。
65926 `native-share-first-dispatch-mutation.log` exit 1：仅私有生产输入
故意把 DeleteLink 移到持久化前，实际 DeleteDocuments 尝试时 Bolt 无 Task，
捕获 `writes=0 PEP=3`。精确还原后，66809
`native-share-first-replay-mutation.log` exit 1：仅私有输入故意对已有 Task
同 key 再次 DeleteLink，即使吞掉错误、返回仍是 UNKNOWN，入口 attempt
变化仍触发 `retry replayed or invented outcome`。两次破坏均未进入正式
工作树；私有生产文件还原后与正式 `native-link.go` 字节一致。

最后原句柄 26736 `native-share-first-execute-restored.log` exit 0，
401.310 秒，含末版 attempt 断言的上述 14 分支全部通过；执行的
`native-link_test.go` 与正式源字节一致。没有重跑整套 Go 或新建环境。
该恢复证明只覆盖原 NativeShareExecution／DeleteLink／Bolt 与隔离 RPC
接缝，不升级为线上 Mongo、完整 share、浏览器验收或 release 准入通过。

补充历史契约兼容：原统一 contract 入口在限定快照因缺根 package.json
退出 2；另一次原 gen.sh --check 容器退出 255、无输出、OOMKilled=false，
保留原日志，不据此声明生成比对通过或改产品迁就环境。此前 66003 原生成
与四侧实际往返证据仍分别成立。随后对最终候选 contracts／私有 index 和
原 Git 历史，只读执行原 tools/check.sh::step_contract 的原 Python
历史兼容谓词，容器 79f45453 实际 exit 0：相对 contracts-v0.1.0 无
破坏性变更（306 schema，匹配 3 历史 schema）。日志在
`/volumes/data/kailo/tmp/cells-share-contract-check.9GBcGX/historical-compatibility.log`；
这不是完整 contract 入口或 full 门禁通过。本批未重新运行 full；此前
d712 全量同时存在产物来源不匹配和 Projects mock 类型失败，后者已由
后续独立提交修正，不能把旧全量失败简写为仅产物来源不匹配。

主线程逐一核对候选 a58dad92e57e119eb86988b85fae1fa3fefb5479 的全部
contracts 与四侧生成物，393 个 blob 与 share-contract-gen.TrupYU 字节
一致，exit 0。文档检查复用原固定检查镜像，2 CPU／2 GiB／等额 swap、
UID 1000、无网络、apps／.design 只读和 Data 临时目录／npm 缓存，不导出
全仓；原 tools/check-docs.sh 的 7 项全部通过，句柄 32450 实际 exit 0。
日志为 `/volumes/data/kailo/tmp/cells-share-docs.NXMuAj/docs.log`。文档
检查读取当时只读工作区，不把它称为产品构建或最终部署验证。

### 2026-10-11 首次上传完成响应的原生读回

本批只修原 `gateway/restv2/native-upload.go::PrepareUpload` 的完成响应，
不增加上传、分享或平台合同。四步影响结论：

1. 权威沿已提交首字节设计与原生结果必须可核验的既定约束。Core 已确认
   COMPLETED 是必要条件，不替代 Cells 当前节点 ACL、不可变 Version 与
   原 Task receipt。固定上游仍为
   `c57f02f4962835447df694c63bd0fd8c22bd7baf`；复用其原
   `/volumes/kailo/.references/cells/gateway/restv2/api-versions.go` 的
   `versionClient`，以及现有受管 `platformPromoteVersion` 的最终读回链。
2. 实际消费者是原 PydioApi.uploadNativeFile 的 prepare → PrepareUpload →
   原 JobService.ListTasks／HeadVersion／PathClient／UuidClient(true) →
   NativeUploadResponse.Completed → 原上传 onComplete。Core 的已有终态
   响应仍携带原 EE 冻结 nativeExecution，无新字段或生成物；native Task
   与等待分支复用同一归属校验，不以当前 generation 回填。
3. 原完成分支只凭 Core 的 VersionId 就回复 Completed，跳过自己的 Task
   核验。现在缺 Task、非终态、AE／EE／代次／用户不符、原字节派发路径
   不符、版本读回不符或当前节点不可访问均拒绝披露完成；不写任务、不
   改 Core 终态、不重派字节。独立原上传和已有等待语义保持不变。
4. 空文件与非空文件同样要求精确 receipt；同 key 换路径、节点被替换、
   原版本丢失、撤权和 RPC 失联都不能变成已完成或新上传授权。IsHead
   仅沿既有 NativeUploadPublishedVersionMatches 排除动态标志，owner／
   location／size／ETag 等不可变字段仍精确比较。此处错误经原页面保留
   UNKNOWN，而不是把读回失败宣布为外部动作最终 FAILED。

实现后验证复用 `kailo-cells-native-check-lftow7` 原 SDK：4 CPU／8 GiB／
等额 swap、UID 1000，预检 available 33 GiB；另一知识库原 Go 检查保留
在途，本批只使用独立 Data `native-go-cache`、`native-mod-cache`。
无新镜像、无全量检查、无 Rust 构建。精确检查源与日志目录为
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-upload-complete.48HCP6`。
仅本批两个 Go 文件解除硬链接后替换；旧验证输入未改变。

原执行命令为 `docker exec -w /workspace/file-storage/.native-upload-complete.48HCP6`
并投递 `GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOCACHE=/cache/build`
`GOMODCACHE=/cache/mod`，`TMPDIR` 指向该快照 `.tmp`，
`CELLS_WORKING_DIR`／`CELLS_DATA_DIR` 指向该快照 `.share-runtime`；容器内
运行 `go test -mod=readonly -count=1 -v -run 'TestNativeUploadCompletionReadsOriginalReceiptVersionAndCurrentNode|TestNativePromoteUsesOriginalHumanAction|TestDeleteVersionRequiresEveryNativeAcknowledgement' ./gateway/restv2`。

- 首次句柄 13869 exit 1：夹具缺原祖先 ListNodes 消费，产生 panic；
  `native-upload-completion-positive.log` 保留。补原祖先流后，15322
  仍在平台观察前拒绝：预加载 Client 却无 Root 跳过原根解析，且错误的
  datasource 名触发原重试。核实本快照测试 PID 3051224 后仅对其 TERM；
  句柄真实 exit 1、日志含 `signal: terminated`／334.231s，明确是因
  已定位错误夹具主动终止，不把未达到目标分支的否定样例记作有效反证。
  `native-upload-completion-routed.log` 保留。
- 夹具使用原 MakeFakeClientsPool 已提供的 `datasource`，移除预加载
  Client，让原 Workspace／Root／Datasource／ACL 全链实际解析；未改
  生产权限判断、未加管理员或跳过 ACL。35303 exit 0／13.605s：
  新增完成读回 17 项、原 promotion 42 项、原 delete 22 项，共 81 项
  通过，日志 `native-upload-completion-resolved.log`。
- 私有破坏只移除新完成证据核验、退回按 Core nativeId 回复 Completed；
  74258 exit 1／7.678s，原 17 项中 13 项失败：两正向检测到缺少真实
  HeadVersion，另外 11 项捕获缺 Task／未完成／缺冻结执行／换路径／
  缺 Version／错误 owner 或 location／节点替换或失联／ACL 撤销／gate
  撤销仍返回 Completed。日志 `native-upload-completion-mutation.log`。
- apply_patch 原字节还原后与正式生产文件 cmp 0；13112 exit 0／
  7.009s，原 17 项全部恢复通过，日志
  `native-upload-completion-restored.log`。格式沿原 SDK gofmt，未增加
  新检查器；原 promotion／delete 的 64 项依据同字节正向运行，不称在
  最后的单过滤还原命令中再次运行。

这是原 PrepareUpload／原 Task receipt 解析／原 PathClient 与 UuidClient
的隔离夹具集成检查；Core HTTP、Task RPC、Version RPC、原生树为夹具。
日志中原 virtual node／docstore 探查的 gRPC PrintStack 亦保留，不能据此
宣称完整原生后端、浏览器上传、部署、Mongo 或有效 binding 上架已验收。
本批未运行 `tools/check.sh --full`，不覆盖此前全量失败与产物来源缺口。

## 2026-10-11 上传恢复使用真实完成时刻并拒绝无派发终态

基于 main `32271da386d97092b9581437abe3af15ca0c2833`，仅原上传三份生产
源码、两份既有事后检查和本回执。没有新合同、权限、状态、默认阈值或迁移。

四步影响结论：

1. 权威是 `.design/07` §5.2 的不可变 revision ACK、原生任务对账与 UNKNOWN
   语义。固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `scheduler/tasks/task.go::Task.CleanUp/SetStartTime/SetEndTime` 使用原执行时间
   写入 Task；当前 `NativeShareTerminal` 同样要求首次派发、结束不早于开始且
   不在未来。本批为已授权治理接入，不改原页面或独立上传。
2. `PruneDraftUploads` 的时间参数只用于选择过期行，不能代替收齐版本与清理
   ACK 后的实际完成时刻。`reconcileNativeUpload` 现在以当时 `time.Now()`
   调原 `CompleteNativeUploadPublication`；该函数在修改 Task 前检查派发时间、
   时序、未来时间及原 int32 时间字段可表示性。`NativeUploadRevision` 在原
   终态解析处统一拒绝缺派发、倒序或未来时间；没有另包一层外部成功判断。
3. 原 `PrepareUpload`、任务 observe、binding reconcile、过期恢复均消费同一
   validator；原 publication、AE/EE、binding/generation、内容与版本引用校验
   保持。无效证据不能披露 Completed，也不能驱动 Finished 快路径清理；不
   回填历史时间、不重传或重派发，不把不明写成 FAILED。现有历史合法终态仍
   稳定，后来正常 prune 不使其回退。恢复拒绝保留原 Task/清理栅栏和原错误，
   继续沿现有有界 sweep/readiness 与 owner 对账，不造第二账本。
4. 合法空文件、非空文件及同一终态重读维持既有行为；无发布计划、部分清理或
   ACK 不明保持 UNKNOWN，缺首次派发、负数、倒序、未来及整数溢出的时间证据
   拒绝。不引入时钟容差。
   Web/Desktop 原页面回读合同不变，Mobile 无新增组件入口。受管延迟 delete
   仍拒绝；现有同请求 HUMAN writer 准入不是后台 SERVICE 通用续签。

验证复用原 `kailo-cells-native-check-lftow7`，4 CPU / 8 GiB、等额 swap、
UID 1000，独立 Data `native-go-cache` / `native-mod-cache`。启动前该 SDK
只有 sleep，宿主 available 32 GiB，另有 Reminder Cargo 与 Knowledge Go；
未使用共享 Rust target、安装依赖、启动新容器或加载镜像。
私有输入及日志目录为
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-upload-terminal.KIrSKd`。
五文件与正式源 cmp 0；只替换私有硬链接副本中的这些文件，不改旧留证输入。

原 SDK 执行 gofmt，环境 `GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off`
`GOCACHE=/cache/build GOMODCACHE=/cache/mod`，TMPDIR 和 CELLS 工作/数据目录
均在该 Data 快照。实际命令为：

```sh
go test -mod=readonly -count=1 -v \
  -run 'TestNativeUpload(DurablePublicationPrecedesTerminal|FirstByteClaimIsNotTerminal|ConcurrentPartsMergeAndCompletion|JobFrozenIdentity|PublicationRecoveryUsesOriginalTaskAndCleanup)$' \
  ./scheduler/jobs ./data/versions
```

- `94596` 正向 exit 0：jobs 四顶层及 18 个子项、versions 原恢复一顶层及
  九个场景全部通过，原 `terminal-positive.log` 保留；未把前一个包的成功
  提前当作整个命令通过。versions 链接阶段发生磁盘写回等待，未重启。
- `23900` 私有反证 exit 1：仅移除三处生产修正，jobs 的 18 个子项及恢复的
  五个子项失败；其中实际恢复报 `sweep cutoff substituted for actual completion
  time`，并捕获非法 Finished 被当作可清理终态。日志 `terminal-mutation.log`。
- apply_patch 还原原字节、五文件 cmp 0；`77725` 同两包恢复 exit 0，四加一
  顶层及 18 加九子项全部通过，日志 `terminal-restored.log`。没有新检查框架。

上述为原 Task/恢复消费者的隔离检查，Job RPC、Version DAO 与对象删除为夹具，
不是完整原生后端或浏览器验收。未跑 full、Mongo、部署、绑定激活或三端验收。

同期只读部署事实：Cells 运行镜像仍为
`sha256:e2bd0ea9fd61ca0d1d6d2f7d834519081ccdde6843c3bc6bb15f8511c2eec7d4`，
OCI revision `afc462d836c770b6f402372b53cd05b3c203786a`，未含已提交上传链；
只有原 data/install/oauth/OIDC 挂载，没有 native-actions 投递。Core 只读事务
查询 component_definition/release/application_binding 均零条，能力合同只有
knowledge@1 ACTIVE，新增 file_storage seed 尚未部署。这些是当次事实，不是
永久配置或成功状态。原 `deploy/start.sh --platform-adapter ENV` 与
`compose.native-actions.yaml`、entrypoint `config-set --value-file` 是既有
投递链；不能在缺真实 binding/service/Resource/actor 映射及完整 conformance
时填造配置。旧 identity-source 只有 subject/username，不能冒充当前可信
principal→native User/scope 映射。必须先部署种子与当前源码、走原注册/验证/
绑定生命周期，才可由既有 owner-only 目录交付真实配置；这次时序修正不解除
七项能力门禁，也不掩盖完整受管删除与分享的剩余缺项。

## 2026-10-11 原异步删除同任务 fresh 准入

本批权威为独立设计提交 `a760a1a7346b2b965db8150af50c67abb41a3520`
的 design 03 §6 / 07 §5.2。实现基于 main
`a3923f375435e31f587b703c1f72f9eb35825849`，不是部署回执。

固定 Cells 上游 `c57f02f4962835447df694c63bd0fd8c22bd7baf` 已从只读
`.references/cells` 用 git grep 复核：`scheduler/jobs/userspace/userspace.go::DeleteNodesTask`、
`scheduler/tasks/task.go::Task.Queue`、`scheduler/tasks/runnable.go::Runnable.RunAction`、
`scheduler/actions/tree/delete.go::DeleteAction.Run` 与
`common/nodes/copy-move.go::CopyMoveNodes` 均成立。改动属于已授权治理接入，
原永久删除、回收站及 CopyMoveNodes 保留；没有运行或修改证据目录。

- 定位权威：原 ComponentTaskWorkflow、AE/EE 与 Cells Task 继续分别拥有平台
  执行及原生任务事实。新增受限 SERVICE 入站仅允许同一已派发任务领取短票据，
  不改变同请求 HUMAN writer 接口，不以 observe 票据写入，不新建 AE 或再次派发。
- 影响面：原 ActionDefinition implementationDeclaration 的明确执行时长与首次
  DISPATCH 审计时间给出固定 deadline；关联 tenant/Operation/AE/EE、actor、target、
  parameter hash 与 correlation，轮询不得重算延长。旧声明缺字段时不开放异步执行。
  原 Task 持久化冻结引用而非令牌；新增可选引用不改变已有无该字段的任务摘要。
  四侧新增请求/带枚举回应、PEP 可选 deadline，生成输入保留已提交 Reminder 合同。
- 副作用：原 Task CreateOnly 和 dispatch 引用先于 PutJob/broker。丢 ACK 后同键只
  观察，不再建 Task/Job；原 HUMAN 的权限、审批、quota、暂停、撤权与 Temporal
  状态每次 fresh，SERVICE 不替换发起人。原用户 UUID 再解析且拒绝 system owner；
  recycle/递归删除仍用原 planner/router，实际每次写入前重验，不另造删除执行器。
- 边界：同 EE.nativeId 尚未投影且全部 fresh 成立时仅返回 PENDING_REFERENCE，
  不给票据；同一协调任务按受控必填 admissionPollInterval 等待至固定 deadline。
  已非空却不同的引用、generation/input/deadline 不符、撤权、取消和不可核网络结果
  均无新写。实际 child ACK 才能终结；部分写、丢 ACK、旧引用缺字段继续 UNKNOWN，
  由原 observe/reconcile 读取同一 Task，不将 TaskError 当业务整体 FAILED。

原 Cells SDK `kailo-cells-native-check-lftow7` 保持 4 CPU / 8 GiB / 等额 swap，
缓存 `/cache/build`、`/cache/mod` 为原 Data 挂载。冻结私有输入及日志：
`/volumes/data/kailo/tmp/codex-cells-native-identity-20261005.LfTow7/apps/file-storage/.native-delete-task.UoOc6R`。
`GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local`，`GOTMPDIR`、`TMPDIR`、
CELLS 工作/数据目录均显式位于该 Data 快照的 tmp，不使用宿主 Go。

```sh
go test -tags=kv -mod=readonly -timeout=5m -count=1 -v \
  -run 'NativeDelete|ManagedDelete|NativeAcknowledgement|NativeMutation|NativeAction|Authorize' \
  ./common/auth/protocol ./common/auth ./scheduler/jobs ./scheduler/jobs/userspace \
  ./scheduler/tasks ./scheduler/actions/tree ./scheduler/jobs/rest ./gateway/restv2
```

最终还原 `52780` exit 0，`final-restored.log`：八包命令通过，其中 auth 与
jobs/rest 无匹配用例，不算新增覆盖；其余包含原 coordinator 五种 ACK 边界、fresh
八种响应边界以及真实 DeleteAction.Run 递归撤权消费者。私有删除实际逐项
FreshNativeDeleteStep 后，`61414` exit 1，`recursive-private-negative-assertion.log`
明确报告 `revocation crossed recursive side effect: err=internal calls=3`；恢复生产
原字节 cmp 0 后得到上述八包 exit 0。没有改预期放行撤权后写。

原失败保留：`90896` 为归档误排除 nested common/service/frontend，`50291` 为旧
检查上下文缺原 config store，`44798` 为新递归夹具缺原 OIDC policy responder；
分别补同 HEAD 输入或原夹具，不关闭安全检查。`47158` 反证首先由重复关闭通道
panic 捕获第二写；夹具使用一次性信号后才运行 `61414` 的直接业务断言。原语言
元数据 RPC 与任务日志驱动未投递的警告保留，不把隔离夹具说成完整后端验收。

共同生成与 Core 输入目录：
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/native-task-generation.NR9iJv`。
原 gen.sh `45151` exit 0；TS native-task 往返 1/1 exit 0，Go `9891`、Dart
`86612` 同一新增往返均 1/1 exit 0。私有 Go 生成物只把请求 deadline 的 JSON tag
改为 `-`，`31956` exit 1，原断言捕获冻结字段丢失；原字节 cmp 0 后 `84974`
还原 1/1 exit 0，日志为 `roundtrip-go-negative.log` / `roundtrip-go-restored.log`。
共同生成新增 ADMITTED 导致 quicktype 将 Go 原 ProtocolSessionViewState 常量
`Admitted` 命名为 `StateADMITTED`；线值未变，当前 Worker 无该旧枚举符号调用，
同名 bool 字段不受影响。这不证明第三方旧源码兼容，不手工覆盖生成物。
Dart 首次 `30302` 缺原合同导出文件 exit 1
保留，补同 HEAD barrel 前已核完整 import/export、全部样例、pubspec 和原离线
缓存依赖闭包；未修改运行中的输入或安装新版本。Rust `27829` 原 contracts
roundtrip 定向 1/1 exit 0，四侧本次新增 wire 均实际通过，不代表全套契约兼容。
首次 Core 命令的 shell
PATH exit 127、误选 lib target exit 101、`41770` 漏原 proto 输入 exit 101 均保留；
随后一次核对 build.rs/include 输入并补同 HEAD proto、registry 与 NIP fixture。
`88674` 误缺 `--bin platform-core` 扩大到集成编译，核实唯一进程组后正常 TERM，
exit 143 记取消；仅以原 `--bin platform-core --no-run` 命令继续，不清缓存。

`42441` 正确原命令 `cargo test --locked --offline -j16 -p platform-core
--bin platform-core --no-run` 真实 exit 0，用时 36m33s；实际输出二进制为
`/cache/rust-target/debug/deps/platform_core-b1cef2465232201a`。随后复用已有
4 CPU / 8 GiB、Data 挂载的隔离 runner `kailo-receiver-observe-sdk-w4qug0`，
连接其既有已迁移专属库 `receiver_observe_w4qug0`，运行同二进制原
`execute_ticket_requires_exact_frozen_nonterminal_intent --ignored --nocapture`，
1 passed / 0 ignored、exit 0。该原事务夹具真实消费治理审计 writer 与 deadline
查询：缺首次派发、错 parameter hash、错 EE 拒绝，正确审计按同 occurred_at 和
冻结 duration 得到稳定期限；事务回滚，不写生产库。它不是 HTTP SERVICE 认证
或真实 Temporal/SpiceDB/quota 联调验收。两容器 TMPDIR 显式位于 Data，未新增
服务或镜像。原 Rust 往返命令仅筛选
`native_task_admission_preserves_pending_without_ticket_and_frozen_deadline`，
未重跑已通过的其他三侧或 Cells 八包。

同目录日志 SHA-256：

- `core-bin-compile.log`：`b8a89c74570117125025e2f32d4b20654854c1d5e5b77804d0cfbc21f46603ef`。
- `core-pg-native-task.log`：`4c147b1ac08407b1b64c6c74e34a7d8678e829873e4c104c0e9493d4ae1d54f8`。
- `roundtrip-rust.log`：`8311065d4264db57326a2ddc57faec6523b3a4ed6c7104641698fdc9d085441b`。

Adapter 原删除文件直接导入 query-revision 检查文件，不能把它误称仅删除检查。
`91179` 全文件 520 pass / 299 fail（遗漏固定前端读入文件及原超时）保留；完整
读取闭包补齐后 `34531` 仍误跑大范围，核实唯一 Node 进程组后 TERM，exit 1
（447 pass、原 final-pep-rotation socket 错误及取消）也保留。最终沿原
`node --test --test-name-pattern` 逐字锚定 native-delete.test.mjs 全部十个顶层名，
原子项全部保留，33/33 exit 0，日志 `adapter-delete-scoped.log`；其余导入检查
由名称过滤排除，未执行，不以此覆盖完整 query/ONLYOFFICE 验收。初始仅新增
UNKNOWN Task 引用检查 `52652` 1/1 exit 0 另存 `adapter-pending.log`。

上述 Go/adapter 的 Core HTTP 与原生 RPC 使用隔离夹具，不证明新 SERVICE HTTP
认证或真实部署已验收。未运行 full、未构建镜像、未部署、未激活 binding；原 release
完整能力验证门禁仍保留。Core/Cells/adapter 合同消费者必须同批发布，不把可选字段
推断为任意旧版本都能执行新受管异步删除。

最终原只读 docs `71665` exit 0，七段全部通过；输入是当前实施文档与设计，
不冒充固定发布树全量门禁。原 check.sh 历史兼容 Python 区块 exit 0：314 个
schema、匹配 `contracts-v0.1.0` 三个历史 schema；314 份实际输入逐一与最终
私有 index blob 相同，不等于所有旧客户端兼容。两项复用固定 `10ad51a279b8…`
镜像、2 CPU / 2 GiB、只读挂载、network none、Data tmp，无下载或大树导出，
短命容器已精确删除。日志目录 `/volumes/data/kailo/tmp/native-task-final-docs.AfPzuS`：
`check.log` SHA-256 `fd80c99ee061f794b23f66fb4d4335b6ebb23582d56ffff0d254697d44edf617`；
`compatibility.log` SHA-256 `2a2a4aaedf4dd174a77da9c96bb39e355d789f39b60914758b3dbfdd36325b55`。

## 2026-10-12 原上传目标 NFC 与冻结意图一致性

本批四步结论：

1. 权威：`.design/07` §5.2 要求上传沿同一冻结执行与目标观察，不因结果不明重发。
   固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `frontend/assets/gui.ajax/res/js/core/http/PydioApi.js::uploadMultipart` 与
   `buildPresignedPutUrl` 都先 NFC 规范化、再去掉一个前导斜杠。本批原样复用该
   发送目标语义，不改变文件显示名、独立上传或平台资源命名规则。
2. 影响：仅将 `uploadNativeFile` 的原 S3 目标规范化提前至 WeakMap 意图键与
   prepare 请求之前；multipart 直接消费同一目标。原后端完成分支对
   `publication.Node.Path` 的精确比对不放宽。原同一 File 的 NFD/NFC 重入不再
   产生两个意图；准备、实际发送与完成回读使用同一键。无合同、数据库或迁移变更。
3. 副作用：不新增请求类型、权限来源或重试。原当前用户校验、执行引用、S3 签名、
   完整终态回读保持；丢回执只观察，不重新发送字节。旧逻辑在 prepare 中冻结 NFD，
   却在真实发送时使用 NFC，导致完成拒绝或等价路径并发重复准入，本批修正此差异。
4. 边界：单 PUT/multipart 的合法完成、回执丢失与等价路径并发都有实际原消费者
   断言；空文件、取消、暂停/恢复、原 token 失败的既有行为在同批回归。未知结果
   不转成功，不扩大原目录/对象授权；非法入参仍由原错误路径拒绝。

源码输入基底 `2e6973daea764b3d447c894f54773c5a9cb0e765`，仅两源码及本回执。
原 SDK `kailo-cells-closure-kxbrvt` 实核 4 CPU / 8 GiB、等额 memory+swap、
UID 1000，执行前仅原 sleep，宿主可用内存 35 GiB。固定镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`；
临时目录全部 Data，复用原 MCP 1.26.0 / xml2js 0.6.2 依赖，不安装或编译。

原执行命令（工作目录 `/evidence/upload-nfc.PDLCHi`）：

```sh
docker exec -w /evidence/upload-nfc.PDLCHi -e TMPDIR=/evidence/upload-nfc.PDLCHi kailo-cells-closure-kxbrvt node --test --test-name-pattern="^(original governed upload|governed upload keeps|governed multipart|original native refresh|original native multipart)" file-storage/adapter/test/query-revision.test.mjs
```

`final-positive.log` exit 0、47/47；随后私有反证仅撤销本批提前规范化并恢复旧
multipart Key 表达式。中间 `final-mutation.log` 已捕获五个失败，但最后并发样例
因旧行为创建两 manager、夹具只保留最后回调而等待；核实专属子进程及 cwd 后
仅 TERM 测试子进程，原会话 exit 1，不能记完整反证通过。补入发送后、等待完成前
的同一意图计数断言，未修改产品来适配夹具；最终以
`--test-name-pattern="^governed upload keeps"` 运行 `mutation-direct-intent.log`，
自然 exit 1、六个分支全部捕获（含父项共七失败），并发明确断言 `2 !== 1`。
恢复私有源与正式两源码逐字 cmp 0 后，原完整过滤命令 `restored.log`
exit 0、47/47、257 ms。末版断言已实际执行，不用早期通过覆盖新增断言。

日志目录 `/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/upload-nfc.PDLCHi`：

- `final-positive.log` SHA-256 `e3ec79e2992306cf6fb213631a93aec36c9d70323472ed6306e00a9397ba8cbe`。
- `final-mutation.log` SHA-256 `ca47651c7e5b10bdc537ffae0e6eb48611ace81ed056e4e9637cb7557c79eafa`。
- `mutation-direct-intent.log` SHA-256 `2ee46f04cdabf09ca7a782c1a7cb62f4b5b2cc88b2bac4d5db376075a2639340`。
- `restored.log` SHA-256 `cab9bf551713caf624b76376b798002400c6646a00a9346715ac03f9b7f7a889`。

这是原 PydioApi / RestClient / ManagedMultipart 的隔离 JS 消费者验证，服务端与
S3 传输使用夹具，不是浏览器或真实 Core/S3 部署验收。本批未构建/部署、未执行
full、未激活或核验完整 binding；真实页面上传与整类 release conformance 门禁
不因该修复通过而解除。未更改 `upstream.yaml` 或其他前端依赖脏改。

## 2026-10-12 登记写入向量接回原生 draft 消费者

本批四步结论：

1. 权威：`.design/07` FILE_STORAGE 七组能力及 §5.2 要求真实原生执行和不可变
   版本证据，登记向量不是成功凭证。固定官方 Cells 来源仍为
   `c57f02f4962835447df694c63bd0fd8c22bd7baf`；本批不改上游版本或原 Promote。
2. 影响：原 `adapter/src/write-execution.mjs::writeInput` 的既有 revision 分支
   只接受 canonical `{nodeUuid,publish:false}` 字符串，登记 write step 却给裸
   UUID，实际 HTTP/MCP 在 Promote 前拒绝。仅纠正
   `contracts/adapter/file_storage.v1/registration.json::testVectorsJson` 的该字段；
   原 node UUID、版本和其他六步不变。read/export 仍从 write 终态取得裸 UUID
   ContentReference，不把输入引用当结果，不用既有 draft 证明首次字节上传。
3. 副作用：适配器、权限、schema、Core bootstrap 及数据库不变。原检查直接读取
   登记 write 输入；夹具对象身份取独立 list_revisions 向量，不在测试里修正坏输入。
   原两次 PEP、实际原 adapter 路由及 SDK MCP 均消费该输入，只有确定版本引用返回。
4. 边界：未知状态、缺 AE/EE/签名键、错误引用、未确认终态、原生不可用和写后撤权
   沿既有拒绝/UNKNOWN；原 observe/extract_usage 不重写。没有放宽原 `publish:false`
   限制，不增加动作、存储或身份。本批不解除完整 release/binding 门禁。

兼容边界：tools/gen.sh 输入仅 canary 与 `*.schema.json`；原 check.sh
`step_contract` 历史谓词同样比较 schema。本批没有 schema、样本、四侧生成或
序列化消费者差异，四侧生成物保持基底字节；未重跑生成/四语言往返/历史兼容，
不能写成这些入口本轮通过。改变的是 conformance suite 内容及其 digest，
不是 schema digest。`capability_contract.rs::bootstrap_contract` 仍严格拒绝
同版本 test_vectors/suite digest 不同。主线程本轮只读 SQL exit 0 核实当前目录
仅 knowledge v1 ACTIVE PLATFORM_SEED，尚未登记 file_storage；本环境仍是零到一。
不能据此覆盖其他环境已经登记的 v1，存在冲突必须沿原新版本注册流程处理，
不得修改 bootstrap 放行、直接迁移覆盖或强设 ACTIVE。

基底 `1e4157c061c6df6972c0efe8783dd581dc797715`；原 SDK
`kailo-cells-closure-kxbrvt` 实核 4 CPU / 8 GiB、等额 memory+swap、UID 1000，
Data 挂载与原依赖树不变，执行前仅 sleep，宿主 available 35 GiB。未安装依赖、
新建容器或编译。独立输入/日志目录：
`/volumes/data/kailo/tmp/cells-native-closure.KxbRvt/write-registration.gSPFCk`。

```sh
docker exec -w /evidence/write-registration.gSPFCk -e TMPDIR=/evidence/write-registration.gSPFCk kailo-cells-closure-kxbrvt node --test --test-name-pattern="^(registered write vector|native write )" file-storage/adapter/test/query-revision.test.mjs
```

正向 `73322` exit 0，41/41；含登记向量 HUMAN/AGENT × HTTP/原 SDK MCP 四分支。
私有反证仅恢复登记旧裸 UUID，过滤 `^registered write vector`，自然 exit 1：
四分支全部失败（含父项五失败），HTTP `400 !== 200`、MCP `-32600`，未改准入。
apply_patch 还原并与正式两文件 cmp 0 后，同原过滤命令 exit 0，41/41、698 ms。

- `positive.log` SHA-256 `b4302cade9118b275fb5f319df0baca5a105d7369ccfdcda388229ed0afccf12`。
- `mutation.log` SHA-256 `29304abf1480e6cab350033f81f73a927b5ad36a404dd8da364380ab39f720fa`。
- `restored.log` SHA-256 `d0bb707b65c39439f4c103e5707b9ce92de3380397b2f8810b2e830dfd468f06`。

这是原 adapter/SDK 消费者加隔离 Core/native HTTP 夹具验证，不是生产注册、
完整七步 conformance 或真实上传验收。实时只读 Cells 镜像仍为
`sha256:e2bd0ea9fd61ca0d1d6d2f7d834519081ccdde6843c3bc6bb15f8511c2eec7d4`，
revision `afc462d836c770b6f402372b53cd05b3c203786a`，仅原四个挂载，无
native-actions 目录。本批未构建/部署、未跑 full/docs，未更改线上配置。

## 2026-10-12 收口原页面构建的直接依赖

本批仅收口上文 2026-10-11 已有构建失败/修复对应的两处遗漏提交，不重建产物。
基底为 `a70a03444d5d96a8243a09a4fe0b12fbdcf63641`。四步结论：

1. 权威为 DD-87/88 与原完整页面复用；固定上游 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的
   `frontend/assets/gui.ajax/package.json::dependencies.uuid4` 已固定 1.1.4。
2. 实际 `access.gateway/res/js/callback/nativeDelete.js` 已提交的 import/请求键
   消费 uuid4；该 workspace 的 package.json 与锁 importer 缺直接依赖会在原
   完整 webpack 构建拒绝。只补同版本声明及 importer，原锁已有 package integrity
   和 snapshot，无新包版本、页面或行为变化。
3. 不影响运行期权限、执行意图或终态；无数据迁移、三端合同、生成物变化。
   不修改上游源码、原 pnpm 冻结锁安装或构建入口，不把依赖 hoist 当作声明。
4. 原缺包失败保留；未知副作用、撤权、重复任务仍由既有消费者处理。本批构建
   依赖收口不宣称业务验收，原 release/conformance 门禁不变。

本次只读核对原成功输入
`/volumes/data/kailo/tmp/cells-delivery-release.qFNxaW/file-storage/`：
access.gateway/package.json 与本候选逐字 cmp 0，SHA-256 同为
`41034086894605c8ec7148667d68546712e963749d9b5bbe862885f40a722332`。
锁文件 access.gateway importer 段逐字 diff 0；整锁与旧快照只差后来已经提交
`e17c85dcd067c44ba34a8ba5a5bc6b4628f3aa1f` 的 action.share 同版本依赖段，
不能将整锁或当前全树称为旧构建输入。原成功日志 SHA-256 本次重新计算仍为
`b821e0c3060630980083a440495d8bb9fc83646975df164eeb004aaead9a0932`，
对应前文原构建 33443 exit 0；日志保留实际 webpack 完成、Cells 版本自检与
OCI 导出，不补造本轮构建结果。

原服务来源 inputs 为 `file-storage/`，Docker frontend stage 完整复制
`frontend/assets` 并执行原 build.sh 全 workspace；compile stage 复制服务树，
用新前端输出替换旧 embed 树后编译 `frontend/assets.go::EmbededAssets`。
已提交的 NFC、首字节、Task/Version 与完成观察源码均处于这个输入闭包；adapter
另由原 src 与 client-kit/adapter 输入构建，没有发现本批文件被排除。
现存 upstream.yaml 四行脏 digest 属旧 2026-10-11 候选，不纳入本提交，不当作
当前源码产物。新版本须由原 build-upstream.sh 实际构建后 record 更新。

准确原入口为 `tools/build-upstream.sh file-storage-service` 与
`tools/build-upstream.sh file-storage-adapter`；前者须投递原 CELLS_VERSION、
GIT_REV、BUILD_STAMP、DOCKER_ENTRYPOINT_SRC_DIR，二者使用受限 BUILDX_BUILDER、
Data TMPDIR 和现有 REGISTRY。入口当前执行 `--load`，所以存储切换前不运行。
本批未重建、未启动 SDK、未部署、未激活 binding；重用的是上述两处相同构建
输入的历史验证，不是当前完整源码通过或生产就绪。全量检查仍由主线程集中执行。

## 2026-10-12 固定上传源码双制品发布回执

本批从干净提交 `a48632b6379b22aab78a60afa348523c309855ca` 导出原构建输入，
固定 Cells 上游仍为 `c57f02f4962835447df694c63bd0fd8c22bd7baf`。后续主干
`bca0e2819e9e298cf97d77076a74b8420c8c23db` 的 file-storage 与
client-kit/adapter 对上述提交逐路径 diff 为零；未复制公共工作树旧脏摘要。
本节更新上一节当时的发布阻断：原 tools/build-upstream.sh 已经在独立提交
移除 --load，现直接推入原 Data registry，未加载根盘 daemon。

四步影响结论：

1. 权威为 DD-87/88/89、原生上传 Task/Version 合同及既有发布来源规则；
   本批只交付已提交源码的真实制品，不新增动作、权限或组件状态。
2. 原 service inputs 完整涵盖 file-storage/；adapter 涵盖原 src、锁与
   client-kit/adapter。原 helper 对实际输入计算 source_digest，再以成功
   BuildKit exporter 的顶层 index digest 登记；没有另算产物摘要或改 schema。
3. 镜像推送、SPDX 与来源登记不创建 binding、用户或 Resource，不修改原数据库；
   配置不齐和完整 conformance 未通过仍不激活。三端没有业务行为变更。
4. 构建失败不得登记，已存在历史记录不代替新结果；本次两个原进程均真实退出 0。
   超时、撤权与 UNKNOWN 仍由原运行消费者承担，本次未做线上故障或上传验收。

实际命令为原 `tools/build-upstream.sh file-storage-service`，随后
`tools/build-upstream.sh file-storage-adapter`。非密原构建参数、私有 index、
source 与完整日志位于 `/volumes/data/kailo/tmp/cells-upload-release.Yv8qvC`。
实际 builder 为 kailo-core-data，8 CPU/16 GiB、memory+swap 同为 16 GiB，
`/var/lib/buildkit` 实际落 `/volumes/data/kailo/buildkit-core-state`。
原 service 会话 22843 exit 0，adapter 会话 1397 exit 0；未重复构建或重启。
service 二进制 version 真实报告该 a486 提交、Go 1.26.8、Linux amd64。

| 产物 | source_digest | registry 顶层 artifact_digest |
|---|---|---|
| file-storage-service | `sha256:1c61d165e105aff1131eda543fe9a3fc17140307f65906240fd9ef2896e628f9` | `sha256:0444e56621b68628018c5c91a4e7a328682c6e9e3aee92c7e71380ee9a99a320` |
| file-storage-adapter | `sha256:6ccd12a879286b4ea7f7eb53d7700d64c59e78b93c2128aa301a2562a46aae10` | `sha256:bab90859da59913f42d5deba2f025006f06c61f8c2c8b9c5bc33683e0fd3f0a6` |

原 registry 位于 `127.0.0.1:55000`。两 index、attestation manifest、SLSA v1
blob 均经 registry HTTP 实读并逐字 SHA-256 比对成功，原件为同目录
`service-{index,attestation-manifest,provenance}.json` 和 adapter 同名组。
这是 BuildKit 默认 minimal provenance：builder ID 为空，request 与依赖完整性
标志为 false；不把它表述为完整源码证明，源码关联另由冻结输入、原 manifest
摘要及 service version 输出成立。未手写另一份成功证明。

复用原 release.sh 的 `syft registry:<repo>@<digest> --source-name <artifact>
-o spdx-json` 实际消费，两份 SPDX-2.3 均成功。原会话 2533 exit 0，已有
Syft 1.52.0；独立 scope 实测 2 CPU/2 GiB、swap 0，Data TMPDIR，峰值 1.0 GiB。
`service.spdx.json` 含 539 个 package，SHA-256
`e07301ebe86a925ec437ff4854c6f446346fdf096e2e53c97d18da6b0e1ce7dc`；
`adapter.spdx.json` 含 335 个 package，SHA-256
`77c8dcf3c4d6895539fef7b03a2f523fd9a25c79ea6122414f3a984199f36039`。
SBOM 不是漏洞扫描通过；原前端 git 依赖 prepare 实际报告 8 个漏洞
（1 moderate、6 high、1 critical），未运行自动升级，原 webpack 警告保留。

完整 `service-release.log` SHA-256 为
`41dd4a33d9343c1d6cae9b98143d4a069243fec888be183f1d0dce7b0682b09c`；
`adapter-release.log` 为
`b88e62826e810846ebdf93b944e421246abb85ac49ab57e0fc18f62e7bd80bf2`。
两个制品构建/推送完成不等于部署或业务验收。当前未替换旧 Cells 服务、
未激活平台绑定、未运行新镜像的普通 SSO 上传/回读、七动作 conformance、
跨服务同步或全量门禁。后续仍经原 start.sh 的配置校验、create 后限额核验、
up 顺序投递，保留现有独立数据库、Data 卷及已创建的专属测试 Workspace。

提交前复用原只读文档容器执行 `bash tools/check-docs.sh /.design`，实际
2 CPU/2 GiB、UID 1000、Data tmp/npm，无新镜像。会话 91696 exit 0，
七项全部 PASS；日志为 `/volumes/data/kailo/tmp/cells-release-receipt.LPJshr/docs.log`。

## 2026-10-12 原 Authfront 已跟踪产物与当前源码同步

本批固定 apps `66afa4f8b26fa51076dbcd06ea9ea73aee3e9a28`，仅重新生成原
`core.authfront/res/dist/AuthfrontCoreActions.min.js` 与 `.gz`，不改生产 JS。
四步影响：

1. 权威为原版完整前端与 `.design/07` §4.6。固定 Cells 上游
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 原 `core.authfront/manifest.xml`
   引用该 bundle，`frontend/assets.go` 嵌入 assets；不是死产物。既有
   `edac76e72` 原登录按钮源码已增加 iframe target/rel，旧 tracked bundle
   仍是前文 b9d64/4329 输出。这次只同步该原生成消费者。
2. 影响为同一个 `webpack.config.js`→`webpack-commons.js::configLoader`→
   CompressionPlugin；固定当前完整 plugin 源（包括 forgotPasswordLink），
   复用原依赖，不手工拼 min.js 或 gzip。正式 service Dockerfile 本来先重建
   完整 GUI 再覆盖 Go embed，因此这次不推断既有匹配镜像缺失该源码修改。
3. 无新 API/权限/配置/身份/数据迁移。目标仍取原同源 nativeLogin.href；
   只在 iframe 下 `_blank`，`rel=noopener noreferrer`；PASSWORD_AUTH_ONLY
   和 KAILO_OIDC_LOGIN 原门槛保留。没有部署、浏览器登录或窗口验收。
4. 原 webpack/压缩失败应停止生成，不用旧包冒充新包；原 UI 身份/拒绝行为
   仍由原消费者决定，不增加重试或回退。缓存与原失败证据均保留。

主机预检 MemAvailable 38,931,451,904 bytes，memory pressure avg10 0；
其他两席确认无在途 Node/Cargo。复用原 `kailo-cells-login-ui-node-20261005`
（原停止137不算本轮失败），start 后仅 PID1 sleep；镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID1000，实际 `cpu.max=400000 100000`、memory.max=8589934592、
memory.swap.max=0、起始memory.current=1003520。原 workspace/npm/pnpm
均为 Data bind；未拉镜像、安装依赖或构建整个 GUI。Node24.21.0、
webpack5.104.1、compression-webpack-plugin10.0.0 为原已安装依赖；
不是重新验证生产镜像 Node22 stage。

独立固定输入与产物目录：
`/volumes/data/kailo/tmp/codex-component-runtime-integration-20261005.lciVUS/apps/file-storage/frontend/assets/authfront-sync.vDGSvl`。
原命令（宿主 pipefail + tee 保留真实退出）：

```sh
sudo -n docker exec --user 1000:1000 \
  --workdir /workspace/assets/authfront-sync.vDGSvl/core.authfront \
  --env NODE_ENV=production --env npm_config_cache=/cache/npm \
  --env npm_config_store_dir=/cache/pnpm --env npm_config_offline=true \
  kailo-cells-login-ui-node-20261005 npm run build
```

96793 实际 exit0，webpack compiled successfully in 5368 ms，14.9 KiB。
保留 npm 对 store-dir 的 Unknown env config 警告；未隐藏为无警告运行。
`webpack.log` SHA256 `f63846766d1d3ebf9eddfbb90233066110d10e6e3785a974ce5b97a5c8f93817`。
生成 JS SHA256 `d48b9701ef163d8b91910c77853f4241fe244702175cbe24151a78225f99d43b`；
gzip SHA256 `05b1955af0af9f6f180f148d406a4aaa1051ef912f5d891a775f401a7a7dae4a`。
`gzip -cd ... | cmp - ...` 实际0。原生成表达式在 Node VM 读取验证：
top-level 返回 undefined、iframe 返回 `_blank`；实际 rel 与两个原门槛
字符串存在，exit0。这是生成表达式验证，不是浏览器 popup/SSO 验收。

用原已安装 Babel parser/generator 格式展开完整旧/新 bundle 后逐段 diff：
唯一业务差异为 target/rel 两属性；另有压缩局部变量 ResetPasswordDialog
的 D→k 对应定义/导出重命名。没有删除其他 exports/原页面实现。完整旧/新
展开文件保留于同目录 old.pretty.js/new.pretty.js；原压缩二文件完整 patch
交主线私有 index，旧生成日志与回执不覆盖。无本轮镜像、部署、binding
激活或完整上传验收；原 service artifact 来源需由原 planner 单独确认。

原 `tools/upstream_manifest.py plan` 两产物前后实际执行均0（34786）：
service 由 `sha256:1c61d165e105aff1131eda543fe9a3fc17140307f65906240fd9ef2896e628f9`
变为 `sha256:2507bb31b94568e49c293ea7b5e0586eaf33a3f845e57f858182fc4867600540`；
adapter 保持 `sha256:6ccd12a879286b4ea7f7eb53d7700d64c59e78b93c2128aa301a2562a46aae10`。
四份 `planner-{service,adapter}-{before,after}.log` 留在同 Data 目录。
原来源算法实际包含这两个 tracked 文件，不因生产Docker另行重编而豁免；
没有更改 inputs/exclude 或把旧 service artifact 重登记为新 source。
原 service `0444e566…` 只证明旧 source 构建，本候选没有匹配的新 service
artifact；adapter 来源仍匹配。后续发布应沿原入口重建并真实记录，不借本次
生成声明已部署或普通 SSO 上传已验收。

原文档快路径复用 `kailo-read-pr-docs-linked`（2CPU/2GiB、等额swap、UID1000、
network none、apps/design只读、Data tmp/npm），实际执行
`bash tools/check-docs.sh /.design`；72054 exit0，七段全部通过。
同目录 `docs.log` SHA256 `fd80c99ee061f794b23f66fb4d4335b6ebb23582d56ffff0d254697d44edf617`。
此原脚本检查顶层实施合同/docs及design，不冒称单独lint全部fork回执。
Node SDK确认仅sleep后原docker stop25332退出0；容器最终137、OOM=false，
没有在途webpack被停止。仅停止本次恢复的该SDK，不删除容器/缓存/证据。

## 2026-10-12 Authfront 同源 service 实际构建与 registry 回读

本批沿上节既定发布后续，不增加业务功能。固定已推源码
`4f2ac2885a9a27395814e2efa5e00ea7da654f97`，官方基准仍为
`c57f02f4962835447df694c63bd0fd8c22bd7baf`。四步影响结论：

1. 原 tracked Authfront 同步改变 service 声明输入，沿原 source digest
   规则重建，不能继续将旧 `0444e566…` 认作新 source 的匹配产物。
2. 原 `build-upstream.sh file-storage-service`、完整 GUI、Go embed 与版本
   自检、顶层 exporter metadata、原 record 为实际消费者；adapter source
   未变，按原规则复用，不另编译。
3. 仅向已有 Data registry 直推；不 `--load`、不替换运行实例、不改数据库、
   凭据或平台绑定。原独立 SSO、Resource/ToolBinding 与完整 conformance
   门禁保持，构建通过不等于普通用户上传通过。
4. 原 pipefail 与 metadata 校验保留，失败不写成功摘要；真实 registry
   字节和 SBOM 单独回读。依赖漏洞告警保留，不自动升级依赖或伪称安全通过。

固定最小导出与私有 index 位于
`/volumes/data/kailo/tmp/cells-service-release-4f2ac.NWyt9K`。
原选定输入对 commit 的完整 Git 比较退出 0；公共脏树和公共 index 不入构建。
原执行为 `sudo -n -H` 读取该目录 `build.env` 后调用
`bash "$GIT_WORK_TREE/tools/build-upstream.sh" file-storage-service`，
`BUILDX_BUILDER=kailo-core-data`、registry 取现有 `REGISTRY_HOST`。
实际 Docker 身份 UID0、配置路径 `/root/.docker`，未读回或输出认证内容。
原 builder 回读为 8 CPU、16 GiB 内存及等额 memory+swap，cgroup swap0；
实际数据卷 bind `/volumes/data/kailo/buildkit-core-state`。
原 helper 两次并发/压力预检通过，宿主可用约 36 GiB，内存 PSI 为 0。

原构建会话 **45796 exit0**，完整 GUI、Go 编译/原 binary version、镜像
export/push 与原 record 均完成。原 Go 层用时 2654.8 秒；版本自检实报
`5.0.3-dev.20261012200952`、Git `4f2ac288…`、Go `1.26.8`、linux/amd64。
service source 为
`sha256:2507bb31b94568e49c293ea7b5e0586eaf33a3f845e57f858182fc4867600540`；
实际顶层 artifact 为
`sha256:2f8f4cf66269506691e1cb93cfb83d885cd4f3a0f88b0eee7dbc92fb74f8a255`。
registry HTTP 200、Docker-Content-Digest 与下载 index 字节 SHA256 三者相同。
原 config 的 revision/version 标签也与 binary 输出一致。
adapter source 仍为 `6ccd12a8…`，复用此前真实 `bab90859…` 产物与独立回执。

原日志 `service-release.log` SHA256
`66dee434feffcb2912c670ab55921516b209ee4512e56322dc6640c3934991e6`；
原 `tmp/build-file-storage-service.jNuRRv.metadata.json` SHA256
`29aa9fb286d0f4c9cfe674977d9d03f63977660699c10f5ae9322ac7b64d836f`。
BuildKit ref 为 `kailo-core-data/kailo-core-data0/mf9ien2qawjk3ec3r2qjgh2l6`。
实际 registry `service-provenance.json` SHA256
`5d1a5c998d7bc59ad0e8cc97bff2dce79a6d6de458d3a1f302fea89e51f50523`，
SLSA v1 subject 为实际 amd64 manifest `2f122b00…`，时间为
20:10:18.652850363 至 21:03:35.926646167 UTC。
这是 BuildKit 默认最小证明：builder ID 为空，request/resolvedDependencies
completeness 为 false，不冒称完整签名源码证明；固定导出、原 planner、
原版本自检和 config 回读共同保留精确来源链。

原 Syft registry 消费者 **19978 exit0**，使用 Syft 1.52.0 与精确新 digest，
`--source-name file-storage-service -o spdx-json`，临时输出仅成功才改名。
实际 scope `kailo-cells-service-sbom-4f2ac.service` 回读 2 CPU、2 GiB、
swap0、User ubuntu、Data TMPDIR；运行 7.137 秒，peak 24.6M、swap0。
`service.spdx.json` 为 SPDX-2.3、539 packages，SHA256
`15be9bf71f1c9d5caf3efc9b2e83dcce12598fb895623a3f2924ee2733550f02`。
`sbom.log` SHA256 `ba3d4133a484d356408fce750a2dc655adb136172213a791b50090ba015cc3f3`。
原依赖 prepare 报 8 项漏洞（1 moderate、6 high、1 critical），pnpm ignored
scripts/webpack 告警保留；SBOM 成功不是漏洞门禁通过。

同原 Data 全量台账已按固定官方至 `4f2ac` 续记：242 路径、
+40797/-3409、116A/126M/0D，全部逐路径分类为 241G/1O/0S/0R/0U；
完整 patch SHA256 `e0c8813b1441e17c8be2cadd38d2202e677a22ef1efc68d58364201ab7c437be`。
仅两项既有 G 生成物改变产品字节；历史台账/来源回执不覆盖。
分类是原版来源与授权用途证据，不是 242 文件全语义或全业务验收。
本批没有部署、binding ACTIVE、普通 SSO 上传回读或新的 full-gate 通过结果。

## 首次 OIDC 登录即时开户（2026-10-20，DD-127(9)，源码阶段）

1. 权威：`.design/02` DD-127(9) 与 `.design/16` V-SCN-171（用户 2026-10-20 批准）。固定 Cells
   `c57f02f4962835447df694c63bd0fd8c22bd7baf` 没有外部 OIDC 自动建号：
   `common/auth/connector-pydio.go::DefaultConnectorScanner` 只加载本地密码 connector，原生建号只有
   `idm/user/rest/handler.go::PutUser`（建 user role、写 `AuditUserCreate`，更新时只回填已有 `pydio:` 属性）与 CLI；
   `idm/user/dao/sql/sql.go::Add` 在目标路径已有节点时就地更新。本节是二开新增能力，不是上游行为。
2. 影响：解析与开户集中于 `common/auth/native-oidc-user.go::ResolveOrProvisionNativeOIDCUser`。浏览器回调
   （`frontend/web/kailo-oidc.go`）传入已按 connector issuer 与专属 client 校验的 `*oidc.IDToken`；文档 PAT
   （`idm/oauth/rest/protocol-token.go`、`idm/oauth/grpc/protocol-document.go`）、WOPI（`gateway/wopi/platform-session.go`）
   与原生动作凭据（`common/auth/native-human-session.go`）传 `nil`，只解析不开户。原 `NativeOIDCUserUUID`、
   `ResolveNativeOIDCUser` 与回调里重复的 SearchOne/VerifyContext 已并入该入口；之后的原生 `oidc/login` policy、
   `CreateLogin/GetLogin/LoginChallengeCode` 不变。connector 识别与链接校验由 `auth.NativeOIDCConnector.Validate`
   单点负责，回调的 `validate` 复用它。没有 Core API、数据库 schema、Workflow 或依赖锁变化。
3. 规则与副作用：解析顺序显式关联 → 派生 UUID（`uuid.NewSHA1(固定命名空间, issuer\0subject)`）上
   `pydio:kailo_oidc_issuer/subject` 精确一致的账号 → 开户。开户只在 connector `provisionUsers=true`
   （`provisionProfile=standard`）且令牌 issuer/subject/audience 与配置一致时发生；进程内互斥后先重新解析，
   派生 UUID 被不带同一关联的账号占用即拒绝；先写原生 user role 再写用户（策略与原 PutUser 相同，根组，
   profile standard，不写 workspace/角色/ACL），写 `AuditUserCreate`，最后按派生 UUID 回读。登录名为规范化
   `preferred_username`，被任一用户或组占用时改为 `<名称>-<sha256(issuer\0subject) 前 12 hex>`（不合法时
   `oidc-<摘要>`），仍占用即拒绝。`name` 写显示名，`email` 仅 `email_verified=true` 时写入；IdP groups 不读取。
   原生 REST `PutUser` 以 `auth.WithoutNativeOIDCLink` 丢弃调用方提交的两个关联属性，更新时由原逻辑回填已有值。
   部署：`start.sh` 要求 kailo-oidc config 显式声明布尔 `provisionUsers`，为 true 时 `provisionProfile` 必须为
   `standard`，为 false 时不得出现；`.env.example` 与 `deploy/components` 两份模板注明取值。
4. 验证（待在 CI 节点 golang 容器运行，本机不编译）：`go test -mod=readonly ./common/auth ./frontend/web -count=1`，
   以及受调用方改动影响的 `go vet`/编译 `./idm/oauth/... ./gateway/wopi/... ./idm/user/rest/...`。
   `common/auth/native-oidc-provision_test.go` 以 idmtest 的 sqlite 原生 user/role/ACL 服务覆盖：首次开户的
   账号形态、user role 与零 ACL、显式关联优先、PAT 路径与再次登录命中开户关联、8 路并发首次登录只得一个账号、
   同名冲突的确定后缀与后缀仍占用时拒绝、开关关闭仍返回 `ErrNativeOIDCNotLinked`、issuer/audience/subject
   不符拒绝且不建号、派生 UUID 被占用或关联属性被复制到其他 UUID 时不解析，以及 connector 校验与 REST 属性守卫。
   `frontend/web/kailo-oidc_test.go::TestKailoOIDCFirstLoginProvisioning` 走真实回调：开启时 303、建一个账号与
   一个 role、未验证 email 与 groups 不入账号、第二次登录不再写入；关闭时 403 且无写入。

完成边界：本节只有源码与测试源码；Go 测试、镜像、部署、生产 connector 投递与三名真人首次登录验收均未执行。
进程内互斥以单实例 Cells 部署单元为前提；与管理员同时手工创建同名用户的竞争沿用原生先查后建语义。

## 2026-10-22 组件一体化呈现（DD-133，07 §4.7，源码阶段）

依据：design-authority `1a8c395e1c67bc3a24119123fd7046731e11c2c8` 07 §4.7.1–§4.7.5；
平台交付 `client-kit/embed`（`03993cc588089cb290152b5d62b621d633c839ab`，已合入本分支）。

- **白标（§4.7.1）**：页面头部依次为 `kailo-web-origin`（取 `KAILO_FRAME_ANCESTORS`）、
  `kailo-theme-tokens.css`、Cells 覆盖层、`kailo-embed.js`、Cells 桥接 `kailo-cells.js`；
  favicon、加载页、登录框/首页/外链页 logo 与邮件 logo 均为 web-client `app-icon.png`。
  三个平台文件列入 `file-storage-service` 的 `inputs`，构建时复制进 `plug/kailo.embed/`。
  标题/邮件为 `PLATFORM_DISPLAY_NAME` + 云盘/Files；en-us/zh-cn 词条去除上游产品名
  （共享“Cell”改称共享空间）；关于/版本、改密码、切换语言、WebDAV 密码、建外部用户、
  个人资料入口由 `reconcile.py` 在 ROOT_GROUP 角色上关闭；欢迎引导、升级入口、
  Enterprise/社区外链、“powered by”页脚移除。
- **静默 SSO（§4.7.2）**：原生 `login` 动作不再打开登录框，直接走 `/auth/kailo/login`；
  iframe 内带 `prompt=none`，IdP 无会话时回调页经 `KailoEmbed.requestTopLevelSignIn()`
  发 wire v1 `auth-required`，不在框内显示表单或弹窗；顶层访问走 Kailo 登录。
  回到原页面路径；三次内未建立会话即停止重定向。
- **用户体系（§4.7.3/§4.7.4）**：每次浏览器登录按 ID token 刷新显示名、邮箱（verified）、
  头像（`picture` URL 原样作为头像地址）、语言；开户账号进入实例所服务 Tenant 的原生组
  `/kailo-<tenant id>`，只对本组成员与原生管理员可见；未交付成员目录前一律 standard，
  不从 IdP groups/claim 派生管理员，控制台提升的权限在下次登录被恢复。
- **退出联动（§4.7.5）**：`POST /auth/kailo/backchannel-logout` 按规格校验 logout_token；
  登录时记录 IdP `sid`/`iss`+`sub` 与原生会话；结束后该原生会话的令牌（含刷新得到的）
  在 `JWTVerifier.Verify` 被拒，并对原生 OAuth 登录会话执行登出；会话最长寿命为
  `backchannelLogout.sessionMaxAgeSeconds`。

验证与未验收边界见本分支提交说明；镜像、部署与 qa-1/2/3 截图验收未执行。

## 2026-10-23 DD-133 上线与生产验收（云盘）

### 部署与登记

- 备份：`/volumes/data/kailo/backups/components/file-storage/20261023-dd133-onlyoffice-pre/`
  （`pg_dump -Fc` 48 个表数据项可列出；数据目录 141 个文件，tar 回读同数；`deploy.env` 字节一致）。
- `deploy.env` 原子更新（备份 `deploy.env.bak-20261023T040120Z-dd133`）：`CELLS_IMAGE` 换成 main
  `a06b5913` pin 的 `file-storage-service@sha256:b3cedac7…`（image revision `0e9c076c`），新增
  `CELLS_ONLYOFFICE_PUBLIC_ORIGIN`、`CELLS_ONLYOFFICE_EXTENSIONS`（取值同 deploy 模板），其余行不变。
- `component-deploy.sh file-storage a06b5913… --check` 与正式部署均 exit 0；容器 healthy，镜像回读
  `b3cedac7`；reconcile：`editor.libreoffice disabled`、`editor.onlyoffice configured`；
  `frame-ancestors 'self' http://192.168.0.193:58090`。
- Release：`render.mjs --material native-page` → `cells@1.1.0-native-page`
  `df9a903f-6b11-5001-9fbb-62a50b098bc6`（manifestDigest `c525ee09…`，`KAILO_EMBED`，
  adapterBuildRef `b3cedac7…`）；register `02bdadc0…` REGISTERED，approve `732966ee…` APPROVED
  （kailo-platform-approver）。平台回读的 manifestDigest 与渲染结果一致。
- Binding：`2dfc7e41-9b32-56c6-9d88-1388b781c846` ACTIVE（create `22b704fc…`，nativeInstanceRef
  `kailo-cells-native`，`nativePageUrl` 58092）；旧 binding `1aaebe72…` disable `37e7d94e…` → DISABLED。
  旧 binding 为 `modelCallMode=NONE`，没有模型 reader（无 `model-delivery-1aaebe72`），retire 不适用。
  未设 `directoryClientId`（成员目录 client 未交付）。

### 验收（qa-1/2/3 各一遍）

脚本与原始输出在 CI 节点 `~/kailo-acceptance/dd133/`：`scripts/acc2.mjs`、`logout2.mjs`、`reauth.mjs`、
`cells-200-205.mjs`、`pic-probe.mjs`；输出 `out-20261023-r2/`。

| 场景 | 结论 | 证据与说明 |
|---|---|---|
| V-SCN-198 白标 | 通过 | 嵌入与顶层标题 `Kailo 云盘`，favicon/令牌/运行时 sha256 等于仓库字节，无上游品牌命中。另见缺陷 3（Pydio 崩溃页的上游壁纸） |
| V-SCN-199 静默 SSO / 重新登录 | 通过 | 首次进入即已登录、无密码框；IdP 会话与原生会话清除后宿主显示“登录已失效…重新登录”，框内为双语提示无表单，点击后顶层登录并回到 `/app/applications/2dfc7e41…`（`reauth/kailo-qa-*-cells.jsonl`） |
| V-SCN-200 资料与头像 | 失败 | 组件显示名取 IdP `name`（`1 QA`），与 Kailo 显示名 `kailo-qa-1` 不一致；`/api/v1/identity/avatars/<sub>` 对同 Tenant 请求者一律 404（未登录 401，设计要求 404），组件内头像为破图（`cells-200-205/picture.jsonl`）。Cells 内无资料编辑入口（通过） |
| V-SCN-201 主题 | 通过 | dark 启动 `data-kailo-theme=dark`，在线切换不重载（marker 保留） |
| V-SCN-201 语言 | 失败 | 见缺陷 1、2；修复 `fix/cells-locale` `dd511513`（未部署） |
| V-SCN-202 KAILO_EMBED 登记 | 通过 | `df9a903f` 以完整 FrontendPresentationContract 登记批准，digest 回读一致；负例沿用 `out-20261023/register-negative.jsonl` |
| V-SCN-203 构建输入 | 通过 | 三份平台文件在 `file-storage-service` `inputs` 中，运行时字节与仓库一致 |
| V-SCN-204 back-channel 退出 | 通过 | 原生令牌退出前 `/a/user` 200，Kailo 退出后 401；三标签页随 Kailo 回到 IdP |
| V-SCN-205 组织映射 | 部分失败 | qa-1/2/3 均在 `/kailo-6179e160-…` 组、standard；成员目录未交付（移出未验）。成员的用户搜索 `/a/user` 列出根组账号（含 Catalog Tenant 的 `kailo-platform-admin`、服务账号），不满足“只列同 Tenant 用户” |

### 缺陷与定位

1. **SSO 后 Kailo 运行时缺失**：`kailoHead` 以相对路径 `plug/kailo.embed/*` 放在 `<base href="/">` 之前；
   框内首次 SSO 落在 `/login/callback`，浏览器请求 `/login/plug/kailo.embed/*` 得到 index HTML，
   `SyntaxError: Unexpected token '<'`，回调随后用 `history.replace` 回到 `/`，整个会话没有
   `KailoEmbed`/`KailoCells`：`lang` 为空、无 `data-kailo-embedded`/主题属性、无法 `auth-required`、
   返回路径不被消费、编辑器拿不到 Kailo 主题语言。
2. **账号语言覆盖 Kailo 语言**：原生会话已存在时，桥接切到 `en-us` 后 `loadI18NMessages` 重载 registry，
   `Controller.setUser` 又按账号偏好（首次框内登录写入 `zh-cn`）切回中文（`lang=en` 但界面中文）。
   修复：`KailoCells.language()` + `setUser` 保持桥接语言；`kailo-embed_test.go` 与 vitest 9/9 通过。
3. 打开 docx 时整页崩溃（ONLYOFFICE 插件 render），崩溃页显示上游壁纸；见
   `onlyoffice-native-editing.md` 生产验收一节与 `fix/onlyoffice-cells-messages`。
4. 单文件作为共享空间根时路径为空间 slug、无扩展名，`EditorProvider` 按路径扩展名判断，编辑器入口缺失
   （以文件夹共享时正常）。
