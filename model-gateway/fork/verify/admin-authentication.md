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

## 2026-10-02 Hybrid 与模型缺授权拒绝源码增量

本节为实现后的事实记录，不覆盖上面的 2026-09-29 实测。固定上游基线仍为
`1f7ebbf87cbdbe9517f6f181221879d04dc50692`；`tools/upstream_manifest.py status model-gateway`
输出「无新提交」。只读 `git show` 核对该 commit 的
`agentgateway/crates/agentgateway/src/llm/model_router.rs::model_authorized`，缺授权原返回
`true`。同版本 `agentgateway/crates/agentgateway/src/types/local.rs::convert_llm_config`
只在声明授权时添加 backend Authorization，Failover provider 从该原生 inline policy 集合继承，
不能只改直接模型判断而留下 Failover 的缺规则旁路（`DD-13/37`、`.design/12`、`.design/17`）。

实际修改如下：

- `deploy/local/model-gateway-config.yaml` 显式使用原生 Hybrid 与 `config.database.url`，连接值仍由
  唯一既有 `AGENTGATEWAY_LOG_DATABASE_URL` 的受控 env 文件提供；删除重复日志库配置，日志通过
  `config.rs::parse_config` 原生 fallback 使用同一库。沿用现有 Gateway 私有 PostgreSQL、凭据与网络，
  没有新增数据库、配置副本或 Core 直连。File 模式的原生资源读取返回空清单，不具有真实 revision
  证据；Hybrid 配置属运行期，重启生效。
- `types/local.rs::convert_llm_config` 一次将缺授权模型归一化为原生 `require: false`；同一规则进入
  ModelRoute 和已有 backend/provider inline policies，显式授权不重写。直接、Weighted、Conditional
  使用既有模型裁决，Failover 继承该 backend 拒绝规则，不另建 PEP 或配置权威。
- `llm/model_router.rs::model_authorized` 缺规则直接拒绝；虚拟模型发现与 Failover 准入复用真实模型
  目标及原 `resolve_concrete_model`。Failover 的内部目标引用来自同一原生配置的声明，序列化不增加
  ConfigResource 正文或公开字段；未知、缺失或全部未授权目标不放行。XDS 原协议只有不透明 backend
  引用、没有模型目标清单，转换保留为空并拒绝，不伪造授权事实；Kailo 不改用 XDS。
- 产品源码写入之后，既有 Conditional 正向用例的模型构造显式声明授权；已有授权用例补缺规则拒绝
  断言，原 XDS Failover 解构同步内部字段。没有新增测试文件、夹具、业务对象或检查脚本。

这项缺省授权裁决是**编译期**安全修正；运行时无法补救旧 binary。现有
`sha256:43366f393c57aedd895ece4ba7ea2fc5f2b6578a1a79bdf3927870888b68df16` 产物登记仍保留原值，
尚未为本刀重建、登记新 digest 或部署。没有生成 LLM listener、provider、llm_route Resource、公开管理
Action 或未消费的 OpenBao file sink；当前 Core `native_route` 的存在性读取不是 `DD-110` 的
Responses、function tool 与 stream 执行证明，不据此提升 AgentVersion/Invocation 或接缝验收状态。

编辑前原生回执为 `994aa3ca536d09ad8ea716c4aad1088f759f552c`、schema 4/current、
`incompleteReasons=[]`、contentDrift current。六个目标的完整 context/impact 原件为
`/volumes/data/kailo/tmp/codex-agent-next-feature-impact-20261002.Xdl8Sl/impact.jsonl`；
`convert_llm_config` 为 HIGH（9 个影响点），已在写入前告警，其调用链含原生 reload、UI validate 与
CLI validate。`ModelRoute::from_xds` 和枚举的 UNKNOWN 不记为零风险；实际动态消费核到
`store/binds.rs::insert_xds_model_route` 的 `agent::ModelRoute::from_xds` 调用及 local/xds 构造。
本刀 before 原字节目录为
`/volumes/data/kailo/tmp/codex-gateway-hybrid-authorization-20261002.ySmy61/before/`。

记录时尚未启动本刀 SDK、格式/静态检查、原生用例、破坏还原、受控 PG 运行或正式 release；没有
通过输出可贴，不记为 PASS。下一批由原受限检查与正式构建入口集中核验；源码、发布、部署、业务
验收分别记录，不把本节当作其中任何未发生步骤的完成证据。

## 2026-10-03 受治理 Route 创建与 provider SecretRef 投递源码窗口

本节只记录已写入源码，不覆盖此前实测和产物回执。权威为 `.design/03` §3/4/8、
`05` §2.1、`17` §9 及 DD-13/37/70/71/99/100：HUMAN 经原 `/api/v1/actions` 创建
Tenant 或可选 home Workspace 的 `llm_route`，Core 是 requested/effective 唯一治理写者，
配置正文留在 Gateway，密钥权威仍为 OpenBao。未新增 Route update/delete、模型默认值、
Agent 工具、第二配置数据库或公开 Gateway 管理入口。

固定上游 `1f7ebbf87cbdbe9517f6f181221879d04dc50692` 已以只读 `git ls-tree/git grep/git show`
复核。原生事实引用为 `crates/agentgateway/src/types/local.rs::LocalLLMProvider`、
`LocalLLMParams`、`SecretFromFile`、`LocalLLMVirtualModel`，以及
`crates/agentgateway/src/config_store.rs::prepare_resource`、
`ConfigResourceStore::upsert_prepared`、`upsert_sqlite/upsert_postgres` 和原 `deleted_at`
存储语义；`.references` 未执行、未修改。

四步实施结论：

1. 权威与真实调用：`LlmRouteCreate` 进入既有 resolve/evaluate/allow/prewrite/dispatch。
   目录为 SYNC、EXPLICIT、HUMAN、Quota/Capacity NONE、meters 空；其他策略不降级。
   `DECLARED_WORKSPACE` 来自已有设计封闭规则，非新默认 scope。调用参数仅为确切原生
   Provider/Model ID、revision/hash 和同 Tenant 的 SecretRef，不接收 URL 或 key 正文。
2. 影响面：新增 `03070000` paired migration 和 `model_route_projection`，先写真实
   PROVISIONING Resource、原 AE 和一次 dispatch fence；只有 file、三份 stored/effective
   ConfigResource、workspace-aware FullyConsistent owner 全部查证后才写实际 native revision
   并激活。ActionCommand 和 WorkspaceRule 的四侧生成由集中入口执行，本节未运行生成器。
   Core 直接消费生成的 `contracts::LlmRouteCreateInput`；已删除本刀最初的三份手写输入
   DTO，只保留内部 SQL 冻结/缺失证据结构，KV version 在原 native u32 边界检查转换。
   原 Version/runtime 验证继续消费同一 Route；Tenant 冻结库存增加 pending 创建意图，原
   GATEWAY 删除处理器查证 config/file absence。生命周期资格只接受同 ALLOWED create AE 的
   PROVISIONING Route，不放宽其他类型的 pending 或普通 Definition CRUD。
3. 副作用边界：沿原 Core-only admin JWT client 及原 AuditObserver/SecretStore 读取确切
   OpenBao version，正文只瞬态投递至 Gateway 独占文件。公共配置只有必填的
   `AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY`，Core 不挂该卷，也不持 Gateway DB 凭据。
   Gateway 原三份 ConfigResource 在同一原生事务 create-only；原 tombstone 保留迟到请求
   的拒绝 fence。受控文件写/退役共享 OS lock，退役 marker 防止迟到 PUT 复活，不更换原配置引擎。
4. 异常与收敛：源 pin 漂移、scope/成员/secret/projection 缺失都关闭；确定未派发且资格
   已失效须查证原生退役及 SpiceDB 完整空集合才能中止。dispatch fence 后 UNKNOWN 只读
   同 ID/hash/file，不重新 PUT；不把 native revision 的缺失伪造为零。删除记录中的空 revision
   表示原生完整集合实际未见该 ID，不是 ACTIVE 证据。暂停/撤权不激活未知投影，Tenant 删除
   先沿原 drain 退役全部使用者，再销毁 native 配置和凭据。对账由原 Governance tick/batch、
   open/oldest-age 度量和 RB-05 责任入口承接；依赖失败保持 UNKNOWN，不以经过时限推断外部终态。

原始窗口位于 `/volumes/data/kailo/tmp/codex-route-producer-before-20261003.ckpjoP`。
其中 main、tenant_delete、WorkspaceRule 三份最初捕获晚于本人窄 hunk；原件保留在
`late-captures`，before 仅逆向移除这些已知本人 hunk 重构，未称其为事前原字节。
其它既有路径保留实际 before，新文件无 before；不把 HEAD 以来继承差异计为本刀。

已实际运行 `git diff --check`，退出 0、stdout 为空。记录时未运行本刀 SDK/格式/clippy、
paired SQL 前进/回退、四侧兼容核对、负向破坏还原或真实 native/OpenBao 端到端。
公开 Action 仍需集中 registry/trace 生成与验收后发布；本节不证明真实 Provider/Model pin、
租户 SecretRef、公共目录投递或 DD-110 Responses/function tool/stream 协议验收已成立。
未重建产物、未改登记 digest、未提交/部署，也不把 PROVISIONING 或 UNKNOWN 声称为可运行。

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

### 同批负向与最终还原结果

源码检查点已普通 push 为 `d82f0f0613168c8080029ee292ea28dc2f1fcd59`，远端读回
一致，相对 `f3323b6c1` 为 2 文件、+237/-21。只有私有 Data 副本恢复原生产列表
函数，保留全部四项后置检查及认证结果断言；编译成功后四项均实际断言失败，
退出 101，而不是用编译错误充当负向。逐字还原到已提交源码 SHA-256
`eb631c72396e8c432712b36f6ddcfecc3ab0cfcc2e8e8f70bac57e28e78a5435` 后，
同 SDK、同目标最终退出 0：4 passed、0 failed、0 ignored、2129 filtered out。
未改变原 API key/模型/virtual 目标授权，Core 恰好一个授权模型的检查不变。

原件仍在上述 `Mjt4jr` 目录：`mutation-old-production.log` 的 SHA-256 为
`162781566d3b1d07c37b4fdc6dd9b74284a71d92b491e7d91899df2b530c1bba`，
`restored-final.log` 为
`2110e29fd9c9d771ab50afddeea1d660fe9833acbc830dfa5a6ddac8f1e23ca1`。
这是原生列表行为验证，不证明新 Gateway 已部署、安装已激活或 Agent 已完成首轮。

同一干净 `d82f0f0613168c8080029ee292ea28dc2f1fcd59` 的原 Gateway helper 仅执行
一次并退出 0，原 release 编译 15m35s，二进制版本自检通过；没有重建其他组件。
source digest 为 `sha256:74b922a507c5fdaa2caa9a9b7b791741feded364fffee914ae394645dc5b2de3`，
artifact 为 `sha256:c51204516640511a2753fe9449c3a3976384e685fba378db852ad32c6a648d91`。
registry 按该摘要 GET 200，响应头、1436 字节 manifest 的独立 SHA 与 Docker
RepoDigest 一致。原件位于
`/volumes/data/kailo/tmp/codex-model-discovery-release-20261003.z7rXAL/`；
`helper.log` SHA-256 为
`bc81867ab92f40183f76e17beb8590b9c0b9d3bbce3f16be283d5ed584b1685b`。
只同步本产物的来源、Compose 与两项既有追溯 pin；不提升任何业务能力状态。

固定树 `489a89e02c16e7e77f1ddce326d8bd8b9087c7d2` 的原
`tools/check.sh --full` 实际退出 0。日志在
`/volumes/data/kailo/tmp/codex-model-discovery-delivery-20261003.QiAOML/full.log`，
SHA-256 `a37caf7079673c973cc1901a38ce42013ce0cef8a47f5d5aa0c6f68d9ddb8009`。
143 个 schema 与三份历史契约兼容、四侧、Core、Worker/replay、追溯与产物来源
通过；未提供真实 DATABASE_URL 的迁移演练、导出树的实际 .env 预检仍 SKIP，
gitleaks 未安装；没有新增迁移。宿主原 `bootstrap.sh --validate-config` 另退出 0。

21:16:52 UTC，原 Compose `up -d --no-deps --no-build agentgateway` 退出 0，
部署上列 c512 产物；新容器为
`c97f3aa016f82ca0f522f9bbed68bc30476c365a1bb9df4e9987f44236cb41df`。
同目录 `live-before.txt`/`live-after.txt` 逐行比较仅 Gateway 改变，另外 23 个运行
服务的容器、镜像与启动时间未变。未重建 Core、Worker、Web 或任何数据库。

原 Installation `8f240978-34bb-437d-97ee-498a30e67e86` 在 21:17 UTC 已读回
Resource/Installation/runtime generation 1/model credential/ChannelAgentBinding
全部 ACTIVE，原 Resource projection 闭合；Core 内受监督 `codex-app-serve`
子进程 PID 541423 实际存在，未打印参数或凭据。任务稍后由原 Workflow 对账
自然收敛：21:23:43.172042 UTC 的 READ ONLY/ROLLBACK 回执退出 0，原 run
`01a10338-aa45-7574-b043-a76f1e89c13f` 保持、WorkflowRef TERMINAL/version 4、
Task COMPLETED/event 1947，waiting_reason 为空、observation_gap=false。
AE 的 DISPATCHED 是既有派发字段，不冒充待完成，也不直接修改。
`installation-terminal-readback.log` SHA-256 为
`68429423f2dc717cdc4050a52c608c13a2cfd87e9faa2fda9412ff281bfd5189`。

原只读浏览器 helper 退出 0：真实 OIDC 登录后的共源管理页展示 Active installation
record，相关 BFF 读取均为 200，pageErrors 为空；它记录的稍早 Running 意图由上述
后续终态回执解释，不改写历史日志。`management-after.log` SHA-256 为
`33f63e8add86d19cb90af390664f184cb0fb9dbb88d80faf22643d44c937b0ec`。
这些证据关闭本次原安装初始化问题；不证明首轮模型执行、频道回复或用量收尾，
也不替代 Win11/Mobile 设备与签名验收。本批无新安装、未知操作重放或业务 SQL 写入。

## 2026-10-10 OIDC locale 产物与原管理资源投递恢复

本次不另改模型路由或权限语义。已提交的 `a6f62135a9ed9909a6a7fcd96732d92cd433b33e`
在 `model-gateway/crates/agentgateway/src/http/oidc/local.rs::LocalOidcConfig` 配置解析及
`model-gateway/crates/agentgateway/src/http/oidc/callback.rs::start_login` 登录跳转消费者接入中文默认/英文 locale；部署仍是旧 binary，
因此原 ConfigResource PUT 在解析现有 `binds[0].listeners[0].policies.oidc.uiLocales`
时返回 422。没有把该确定拒绝记成模型已写入，也没有删 locale 配置绕过。

原 `tools/build-upstream.sh model-gateway` 作业 66070 实际退出 0。沿既有
`kailo-core-data` BuildKit、8 CPU / 16 GiB（swap 同额）与 Data 盘缓存，构建前核查
并发和内存，未调整 Cargo 并行度。固定上游仍为
`1f7ebbf87cbdbe9517f6f181221879d04dc50692`，源码摘要为
`sha256:7411d0e07914cf1a5ebe9c0b5361d19fd1f245730ac86f9c0f664fa1654f9bc5`；
release 编译与内置 version 自检通过，日志为
`/volumes/data/kailo/tmp/embedding-route-20261010.jELlQ0/build-model-gateway.cNVYHX.log`。
实际推送产物为 `sha256:accd2243c94c3f72c150c70f8bc397e1e791735f87ca87b2bc13de4ddcdaa3fe`。

registry 使用 OCI image manifest media type 读取固定 digest 为 200，响应正文
`sha256sum` 与该 digest 一致。首次只接受 OCI index 的请求返回 404；改为该产物真实
manifest media type 后读回，不把首次空响应的哈希记为产物。来源记录、Compose 镜像
及两份既有 traceability 引用同步该实际摘要，没有手填新源码摘要。

22:53:06 UTC，原 Compose `up -d --no-deps --no-build agentgateway` 退出 0，实际
新容器 `082be3b2dad85ba870509f9b50f12a4231b5083f99e8f65134eae8928cd265a2`
运行上述固定镜像。预检 `config --quiet` 退出 0；与旧容器比对，投递环境键值与
启动命令未变。原生日志确认 PostgreSQL 配置库连接、加载现有配置及 state manager
ready；容器 running、exit=0、restart=0。前后另 22 个运行平台服务的容器 ID 未变，
未重启 Core、Worker、Relay、Web 或数据库。Gateway 重建会使旧内存 OIDC 会话失效，
随后旧浏览器流收到 401，需沿原登录恢复，不放宽认证或将此记为业务成功。

本节只证明产物与 Gateway 部署，不证明嵌入模型 PUT、SERVICE binding、三组件菜单、
模型执行计量或全量验收；这些仍须各自真实 API 与页面证据。当前批次旧 full 作业
69733 已退出 1，不能拿历史 full=0 覆盖本候选。

### 2026-10-10：原向量模型配置 API 恢复（非 Route 或 binding 激活）

Gateway 更新后沿原 Core `OIDC_TOKEN_URL`/服务身份与
`AGENTGATEWAY_ADMIN_URL` 访问原管理 API，没有新建账号、凭据或管理 helper。
匿名 `GET /api/config/resources/llm.provider` 实际为 401；原服务身份读取为 200。
两个既有 source pin 的 revision 仍为 1，canonical SHA 与原记录相同。

先读取 stored 与 effective，确认 `qwen3-embedding-4b-provider` 和
`qwen3-embedding-4b-source` 精确缺失；然后对每类原
`PUT /api/config/resources/{kind}` 仅发送一次原 JSON，均返回 200。
两项随后 stored/effective 均 200、完整值与输入一致，revision 均为 1：

- provider SHA：`1bb5b3f053472f8f6a002f3e03a912fff45b7569b50f24a68a372179cef49622`。
- model SHA：`760ab41ad3bf56cad470ac6e0ae6d37d875a33dcc7d925bfa4e9404a296a68e1`。

原执行退出 0；脱密日志为
`/volumes/data/kailo/tmp/embedding-route-20261010.jELlQ0/native-config-resume.log`，
SHA-256 `541b35bb5cb1a385143855a72b0645b8ebb37cbd0b71cf08c7af45abb0e6684a`。
此前 `native-config-rejection.log` 的 422 保留：旧版本不认识 `uiLocales`，
原 `validate_materialized_config` 在 `upsert_prepared` 前拒绝，没有落库。
本次没有删除该字段、重写旧 source 或盲重放未知结果。

这只完成原 ConfigResource 配置与生效读回；未创建平台 LlmRoute、
ApplicationBinding 或凭据，没有发送推理请求，也未运行 Wren 原生部署、
prepare/observe 或完整 conformance。后续仍须正常受治理动作与真实模型投递。

### 2026-10-10：原 HUMAN 动作创建嵌入 Route

独立 `kailo-model-route` 浏览器沿正常 HUMAN SSO 登录，原 `/api/v1/session`
返回 FULL，tenant 为 `6179e160-6055-4e9a-ae63-1793509c230c`，实际 principal
为 `91b92140-cc3f-404b-8f4c-ce93782bfe9e`，不是旧 Route 的 owner。
原 BFF 确认该用户是现有 Kailo workspace 成员；SpiceDB fullyConsistent
tenant/create 返回 HAS_PERMISSION。未切换管理员、补授权或使用 SERVICE 冒充 HUMAN。

先只读全部同租户非 DELETED Route，确认不存在该 embedding source pin。
2026-10-10 23:03:29 UTC，原 `/api/v1/actions` 仅提交一次 `llm_route.create`，
使用上节两个真实 revision/hash、显式 `providerCredentialMode: NONE`，不携带
providerSecretRef。幂等键 `84be8ee2-bd7f-4cb2-bf39-243df8650840`；返回 200、
ALLOWED/DISPATCHED，AE `2e2c9f5e-7c29-45a8-8d72-c220cb89a68d`，operation
`b2bce134-5845-4e44-bf64-7f800ab698e7`。随后只观察原 task 和投影，没有重新 POST。
Route `de79e6c3-4b61-4267-92df-119639ba5f27` 实际 ACTIVE/version 2，owner 为
上述实际 HUMAN，home workspace 为 `ad9a6443-f0a2-47d2-895d-f11b8fef9e38`。
原 Gateway provider/model/virtualModel 的 stored/effective 全值与冻结投影
hash 一致，均 revision 1；virtualModel SHA 为
`f703f5cbe9577a77cde6c02bf534269f359f7ed1b42addcc13b768eadbf4a93e`。

脱密证据均在 `/volumes/data/kailo/tmp/embedding-route-20261010.jELlQ0/`：
`human-route-submit.log` SHA-256 `32661621a011d6f1bff56a8b390fddb616813554ec660b20c406478f9e9eb89f`；
`human-route-task.log` SHA-256 `8aaffa5910fcd5b8507bf68cb282ec62ab558e814427de1c9f3890a3490e9cf0`；
`human-route-effective.log` SHA-256 `0a0c430ef1e9d8b521feaead636facc5331811004b3c1a081ff2252eb23b3fb0`。
该次原命令均 exit 0；没有执行推理、创建组件 binding 或输出秘密。
同轮只读 ComponentDefinition/Release/ApplicationBinding 仍各为 0。Route 可用
不等于 Wren 已部署或获准；原组件 conformance、release、绑定及 Bao 投递仍需完成。
