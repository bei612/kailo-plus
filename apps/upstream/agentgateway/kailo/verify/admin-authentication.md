# SS-AGW-ADMIN 接缝证据

对应 `SF-AGW-02`、`SS-AGW-ADMIN`、`DD-13`、`DD-37`。补丁：`patches/0001-admin-core-service-auth.patch`，
基于 `1f7ebbf87cbdbe9517f6f181221879d04dc50692`。

## 为什么必须改上游

`management/admin.rs::admin_router` 自有 `quitquitquit`、pprof、`config_dump`、`logging`，并合并
`ui::router` 的 `GET|POST /api/config`（POST 覆写配置文件）、ConfigResource CRUD（含可改监听端口与
TLS 的 `llm.settings`/`mcp.settings`）与日志/成本查询。整个 router 只有一层 CORS，没有认证
（`SF-AGW-02`）。内网地址与 CORS 都不是认证（`DD-13`），因此接缝在 router 本身闭合。

## 认证方式与依据

设计只规定「Core-only service authentication，INSTANCE_SERVICE，凭据按 DD-70/71」，没有写死载体。
选定唯一方案：**Core 自有 OIDC client 以 client_credentials 取得的 JWT，放在
`Authorization: Bearer`**。依据：

- `DD-37`：组件用自己明确支持的 service credential。AgentGateway 上游已有 JWT/JWKS 校验
  （`http/jwt.rs::Provider::from_jwks/Jwt::validate_claims`），补丁复用它，不新增密码学实现；
- `DD-70`：OpenBao 是唯一 secret 权威。JWT 方案下网关只持有公开的 JWKS，不持有任何可用于调用
  admin 的 secret——而 `config_dump` 本身就在 admin 面上，放一把共享 PSK 进网关配置等于把钥匙挂在门上；
  Core 的 client secret 仍按 DD-70 托管；
- 与本仓库已有的 service 身份同形：`core/crates/kailo-core/src/service_auth.rs`（Worker→Core）与
  ADR-12 入站方向，都是「每个调用方一个 OIDC client + 逐条核对 issuer/audience/签名/有效期 + `azp`
  精确映射，不做通配」。

## 补丁做了什么

| 位置 | 改动 |
|---|---|
| `management/admin_auth.rs`（新） | `RawAdminAuthentication`/`AdminAuthentication` 配置；`require_admin_client` axum middleware |
| `management/admin.rs::admin_router` | 在全部 admin 路由（含合并进来的 `ui::router`）外层加该 middleware；CORS 仍在最外层，只应答无副作用的 preflight |
| `lib.rs`（`RawConfig`/`Config`）、`config.rs::parse_config` | 新增 `config.adminAuthentication` |

接受条件（全部成立才放行）：JWKS 验签；`iss` 等于配置；`aud` 含配置的 audience；`exp` 必须存在且未过期
（有 `nbf` 时校验）；`azp` 与配置的 `clientId` 逐字相等。

拒绝语义（fail closed）：

| 情形 | 结果 |
|---|---|
| 未配置 `adminAuthentication` | 每个 admin 请求 401 `admin authentication is not configured`——不存在无认证模式 |
| 无 Bearer / 非 JWT / 签名、issuer、audience、exp 不符 | 401 |
| 令牌有效但 `azp` 不是 Core 的 client，或缺 `azp` | 403 |
| JWKS 取不到或解析失败 | 503，同样不放行 |
| 配置里 `issuer`/`clientId` 为空、`audiences` 为空或含空值 | 配置解析失败，进程不启动——空 audience 在上游等于关闭 audience 校验 |

JWKS 每次按 `cached_or_direct` 读取：数据面 JWT 策略已缓存同一 URL 时复用其缓存，否则直接取，因此
IdP 轮换签名密钥后无需重启网关。

## 配置写法

```yaml
config:
  adminAddr: 0.0.0.0:15000
  adminAuthentication:
    issuer: ${OIDC_ISSUER}
    audiences: [${AGENTGATEWAY_ADMIN_AUDIENCE}]
    clientId: ${AGENTGATEWAY_ADMIN_CLIENT_ID}
    jwks:
      url: ${OIDC_JWKS_URI}
```

`config:` 段在解析前做环境变量展开（`config.rs` 的 `shellexpand::full`），取值不写死在文件里。

## 实测（源树 `cargo test -p agentgateway --lib`，2026-09-29）

新增 `management/admin_tests.rs` 用例，起真实 admin 服务；签名密钥在测试运行时以 `rcgen` 生成 P-256 密钥对（公钥作为内联 JWKS），不含任何私钥字面量：

| 用例 | 结果 |
|---|---|
| `admin_rejects_every_request_without_admin_authentication`：未配置时 `/`、`/config_dump`、`/memory`、pprof、`POST /quitquitquit` 带合法令牌也 401 | 通过 |
| `admin_requires_admin_client_token`：无令牌、非 JWT、错 issuer、错/缺 audience、过期、缺 exp → 401；他人 client、缺 azp → 403；Core client → 200；无令牌 `quitquitquit` → 401 | 通过 |
| `admin_fails_closed_when_keys_are_unavailable`：JWKS 文件不存在 → 503 | 通过 |
| `admin_authentication_rejects_widening_config`：空 audiences、空/缺 clientId、空 issuer 的配置解析失败 | 通过 |
| 上游 `test_admin_config_dump_redacts_secrets` 改为带 Core 令牌后仍验证脱敏 | 通过 |

整 crate lib 测试 2124 通过、0 失败（含两个补丁）。

破坏核验：把 `require_admin_client` 改为不做认证直接放行，上面前三个用例失败
（未配置仍 200、各类坏令牌得到 200、JWKS 缺失得到 200）；还原后全部通过。

## 部署前提（编排层，已落到 deploy/local）

- 身份：复用 Core 已有的 service client（`OIDC_SERVICE_CLIENT_ID`，confidential、只开 service account），
  不另设身份；realm 为它加 `agentgateway-admin-audience` audience mapper，签入 `AGENTGATEWAY_ADMIN_AUDIENCE`。
  Core 的 client secret 照旧只在 `secrets/core-service.env`，网关不持有任何 admin secret；
- 网关：`agentgateway-config.yaml` 的 `config.adminAddr: 0.0.0.0:15000` 与 `config.adminAuthentication`
  （issuer=`OIDC_ISSUER`、clientId=`OIDC_SERVICE_CLIENT_ID`、jwks=`OIDC_JWKS_URI`）；
- 网络：admin 端口不发布到宿主，不接入 `mgmt`（`check.sh` 禁止 edge 与 mgmt 同属一个服务），Core 经
  两者共有的 `app` 网络访问；网络隔离只是纵深防御，认证不依赖它。
