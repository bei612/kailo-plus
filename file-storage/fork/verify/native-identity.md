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

- 原 Go 锁与完整 UI 没有改变；仅执行原包窄编译/测试，没有产品镜像、集群或业务写操作。
- 新 HTTP consumer 的源与 case 不等于运行配置已投递或三人真实身份可登录；尚无该 native OIDC client/受控 secret/native UUID 链接投递证据。
- 未增加原生登录页按钮；当前入口为同一原生 UI 宿主 `/auth/kailo/login`，不是第二前端。
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
