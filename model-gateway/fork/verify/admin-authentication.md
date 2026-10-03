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

## 2026-10-03 本窗口原生构建与拒绝边界终态

本节为前一源码窗口实施后的实际执行记录，不改写上述历史。原件全部位于
`/volumes/data/kailo/tmp/codex-route-native-delivery-20261003.5lJP72`。

原 native 固定 commit `1f7ebbf87cbdbe9517f6f181221879d04dc50692` 的
`Cargo.toml`（uuid 依赖）与 `crates/agentgateway/src/ui.rs::App::ensure_writable`、
`App::config_resource_store`、`upsert_config_resources_by_kind` 已以只读 `git show` 重验。
上游 Git 树路径为 `crates/agentgateway/src/...`；此前 2026-10-02 文中
`agentgateway/crates/...` 的前缀是外层目录描述，不是该 commit 内的 Git 路径，引用在此纠正。
上游 uuid 只有 v4/v7、没有 serde，原 Path 提取器使用 String。

- 原不可变 SDK 内 rustfmt 对四 native 源实际退出 0，UID1000:1000、4 CPU、8 GiB、
  memory+swap=8 GiB。它是原 Rust1.90 格式工具，不冒称为下面的 Rust1.98 native 编译。
  初始纯格式原件 `native-format-only.diff`；后续真实修复原件
  `native-format-and-compile-repair.diff`，SHA-256
  `6bc8b70224838b529c735ca40d38cfe7237510ef112a0a0acd7e0328d0bf1304`。
- 第一次原 `tools/build-upstream.sh model-gateway` 实际退出 1，五个 Axum Handler E0277
  原件保留在 `model-gateway-build-first-failed.log`、`build-model-gateway.jaIueJ.log`。
  新 Path<Uuid> 不满足既有依赖的反序列化条件，已直接沿原 Path<String> 加原
  `Uuid::parse_str` 严格解析；credential 三路使用原 String tuple 后同样核 nil/version。
  没有改依赖、认证、Future Send、生产配置或 credential 正文边界。
- 原两个 `ui::tests::ensure_writable` 在实现后增加对真实新 Handler 的拒绝断言，
  未新增测试函数、fixture、Provider、模型或有效 key。沿已存在 native SDK
  `sha256:17a2ffedc7792a8dc0bfb17f34d6dd928db5efff67d5698d3c449cb6ffb94936`，
  实际 Rust/Cargo1.98.0、4 CPU、8 GiB、swap.max=0、Cargo jobs 未设置。
  `cargo test --offline --locked --profile ci -p agentgateway --lib ui::tests::ensure_writable -- --test-threads=1`
  原件 `native-handler-check-baseline-retry.log`：退出 0，2 passed / 0 failed。
  首次离线启动因 rust-toolchain 短名触发 rustup 下载而退出 1，原件
  `native-handler-check-baseline.log`；显式用原镜像已安装的 1.98.0 后才进入上述检查。
- 后置 Data 变异不接触正式或 helper 输入。仅删除 create 的冗余 ensure_writable 仍 0，
  因原 config_resource_store 对 ReadOnly 仍 403，不冒充有效负向。实际把新 create 的拒绝
  响应变成 200 后检查退出 101（200≠403）；实际移除 credential 空值拒绝后检查退出 101
  （503≠400）。原件为 `native-handler-response-mutation.log`、
  `native-secret-empty-mutation.log`。没有投递 secret directory，变异不写凭据文件。
  两源逐字还原后 `native-handler-secret-restored.log` 退出 0，2 passed / 0 failed，
  与正式及 helper 输入 cmp 相同，四源 SHA 核对全部 OK，检查容器均已清理。
- 原 helper 重试 45510 实际退出 0。已有 builder 保持 8 CPU、16 GiB、Data 原缓存，
  Cargo 并行不改变；原 pinned Node UI 构建在首轮实际通过，重试使用其真实缓存。
  原 Rust1.98 release 编译实际 13m40s，binary 原版本自检 0，完整过程
  `model-gateway-build-retry.log` / `build-model-gateway.c5Q1Fz.log`。
  原 source_digest 算法对正式和机械导出均为 2658 输入、
  `sha256:14dcdee04d6f6a18cbe506505bd6d3c51cf134aaefe207d0459503c3ca98fd99`。
  helper 只写 Data manifest 两字段，真实产物为
  `sha256:f3008585dadda509afc738dd28de925e37019abe64a100b3d928fe071a3a91a0`。
  registry 实际读取 200，Docker-Content-Digest 与 manifest 字节 SHA 都等于该 digest；
  原件 `registry-readback.headers` / `registry-readback.manifest.json` /
  `registry-readback.receipt`。正式 manifest、Git index、提交与部署不由本刀修改。

两项直接 Handler 检查证明 readonly、非法引用、空 credential 的拒绝边界及其错误分类，
不是 create-only DB transaction 或真实 credential 写/退役的业务验收。未创建业务 Provider、
模型、Key 或默认配置；真实租户 OpenBao SecretRef、Gateway requested/effective 回读、
DD-110 Responses/function tool/stream 以及 LLM 业务 E2E仍未验收。
镜像/registry 成功不提升这些验收状态；Core 本刀 paired migration、全量门禁由主线另列。

### 2026-10-03 Git 导出输入换行收口

上述 f300/14dc 保留为原历史。原完整检查发现 Git LF 导出与当时 README CRLF
构建字节不一致；实际唯一差异为 `crates/htpasswd-verify-fork/README.md`，
四个 Rust 源完全相同。未更改 Git attributes、输入算法或源码能力。
沿原 helper 以 Git 实际 LF 字节重新构建，实际退出 0；source 为
`sha256:c606f8245b8af8b5172b8feb9f5f24a781750dc41c4aac05e69bc41265967fe5`，
artifact 为 `sha256:14bf9f878fbca870361171331ac4401f7c3fa5cd8168c665ae9061a4b2a674e7`。
registry GET 200，header 与 manifest body SHA 独立读回一致；选定与正式实际
source 均相同。原件 `codex-agent-management-web-win-20261003.yUA7u9/gateway-lf-helper.log`
SHA-256 为 `f700d89df9fd70020438214d1672dda58350917f2f0b1d0baae1719afdc7da93`。
真实 helper 仅更新两字段 metadata；未重建 Web/Win、未部署、未进行 LLM 业务验收。

## 2026-10-03 模型发现同名投影修复

原安装在 Core scope 修复后进入凭据对账；Gateway 原生库中该凭据已创建，
同一治理 Route 投影同时具有同名 concrete 和 virtual model。原模型列表直接
拼接两组，能返回重复 ID；Core `GatewayHttp::check_model` 要求授权列表恰好
一个且 ID 匹配，因此不能把 HTTP 200 当作凭据可用。此处没有删除 Core 的检查，
也没有重新派发安装或创建替代凭据。真实 HTTP 正文尚未读取，源码与库投影是
定位证据，不冒充请求正文实测。

四步实施结论：

1. 权威为 DD-13/37/70/71/110、SS-AGW-PEP；固定上游
   `1f7ebbf87cbdbe9517f6f181221879d04dc50692` 的完整 Git 路径
   `crates/agentgateway/src/llm/model_router.rs::ModelRouter::resolve` 已只读重验：
   同名 virtual 优先，拒绝也不回退 concrete。修复的是原发现函数与原解析规则不一致，
   没有另建模型目录或权限策略。
2. 影响面为原 `ModelRouter::model_list_response` 和已有 API key 模型发现消费。
   先按 virtual 输出，再按最终发现 ID 排除被 virtual 占用的 concrete，最后稳定去重；
   wildcard 展开后同样核对最终 ID。权限过滤前保留全部 virtual 名称，拒绝不会
   暴露同名 concrete。原 API key、模型授权和 virtual 目标授权谓词全部保留。
   不更改契约、数据库、Workflow、客户端或 Codex 协议，无格式迁移。
3. 此路径只读，不创建外部副作用、第二权威或新状态。同名条目的 created 取 virtual，
   同类重复保留原顺序的首条；不同授权模型仍各自可见。三端仍经原 BFF 管理面，
   不把模型密钥交给 Web/Desktop/Mobile。
4. 空集合仍为空、未授权仍不可见、未知目标仍由原拒绝裁决处理。列表不能证明凭据
   查证成功时 Core 仍保持依赖不可查证/UNKNOWN，不改判业务成功或失败；重入、
   并发与恢复继续由原安装对账收敛，不新增重试写入或期限。既有上限、背压和
   暂停/撤权 guard 不变。实现后补四项检查，覆盖同名、重复/wildcard、拒绝遮蔽和
   不同授权 ID；原生 SDK 的实际执行回执另列，不以源码存在称通过。

源码检查点回执：原 native SDK `17a2ffed…` 的 Rust/Cargo 1.98.0、4 CPU、
8 GiB、swap 0、Cargo jobs 16 下，原 `cargo test --offline --locked --profile ci
-p agentgateway --lib model_list_ -- --test-threads=1` 实际 4 passed / 0 failed，
2129 filtered out，退出 0。首轮因测试的 `log::Config` 不实现 Default 编译退出 101，
修正为既有显式构造后才通过；日志位于
`/volumes/data/kailo/tmp/codex-model-discovery-validation-20261003.Mjt4jr/` 的
`baseline.log` 与 `baseline-repaired.log`。后者的 must_use 警告随后以原
`PolicyResponse::should_short_circuit` 断言收口，最终负向及还原执行仍在进行。
native SDK 缺 rustfmt 的退出 1 保留；复用原检查 SDK `10ad51a2…` 的 Rust1.90
格式工具，显式 toolchain 与 edition 2024 检查最终源码退出 0。文档原检查退出 0；
此检查点尚未运行本批 full、构建、部署或原安装恢复验收，不登记新 artifact digest。
