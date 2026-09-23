# 统一身份与 Buzz 协议投影

本文详化 `03` 的 Identity/Binding，不把 Buzz Community/Channel 误当成业务 Tenant/Workspace 权威。

## 1. 四层身份

| 层 | 对象 | 作用 |
|---|---|---|
| 边缘认证 | AgentGateway OIDC cookie session（Buzz Web）；AgentGateway jwtAuth Bearer（原生端，DD-78） | authorization-code+PKCE、ID-token 校验与 browser session；原生端为 RFC 8252 取得的访问令牌 |
| 平台身份 | `HumanIdentity + ExternalIdentity + PlatformSession` | issuer+subject 唯一映射、Tenant membership 与业务 session |
| 业务主体 | `Principal(HUMAN/AGENT/SERVICE)` | Tenant 成员、SpiceDB 关系、owner/actor/producer |
| Buzz 协议身份 | `BuzzIdentityBinding(pubkey, secret_ref)` | NIP-42/NIP-98 与 event 签名 |

OIDC subject 不是 Nostr pubkey，IdP role 不是 SpiceDB permission。AgentGateway 只把已验证 issuer/subject 送到内网 BFF；BFF 重新解析 ExternalIdentity/TenantMembership，禁止把 `jwt.groups` 直接写成 SpiceDB relationship。一个 HUMAN/AGENT Principal 在一个 Tenant 有自己的 Buzz pubkey，不与任何其他 Principal 共享；HUMAN 可同时持有 Web 的一把（SERVER 托管）与每台原生设备各一把（CLIENT 托管），全部归属同一 Principal（DD-77）；CONTROL SERVICE identity 只用于 Community/roster 管理和该 Tenant 的 NIP-AE Memory Counterparty/解密边界，不代表人，不得成为 Resource/Asset owner 或业务 actor（DD-66）。

Agent Definition/Version 不持有运行身份。每个 Workspace AgentInstallation 创建独立 AgentPrincipal 与 BuzzIdentityBinding；同一 Definition 安装到两个 Workspace 时不得共享 pubkey、Delegation、runtime state 或额度归集（DD-25）。

该分层是必需的：Buzz Relay 仅从 NIP-42/NIP-98 得到 pubkey（SF-BUZ-02），ingest 要求普通 event pubkey 与认证 pubkey 一致（SF-BUZ-03）；Buzz 的 `okta_user_id` 没有 Rust 运行路径，不是 OIDC adapter。

### 平台与组件 ServicePrincipal

| 调用者 | 身份绑定 | 约束 |
|---|---|---|
| Core/BFF → Buzz | Community 创建使用部署级 RelayOperatorIdentity；业务 event 使用对应 HUMAN/AGENT BuzzIdentityBinding；创建后的 roster admin 使用 Tenant CONTROL；NIP-AE 写入使用 Installation AGENT，受权管理读取使用 CONTROL counterparty | Relay operator key 只签精确 operator origin 的 NIP-98，不成为业务 Tenant Principal；HUMAN/AGENT event signer 不能换成 CONTROL 或共享 service pubkey（SF-BUZ-03/06/16/19、SS-BUZ-OPERATOR） |
| Core → SpiceDB | bearer preshared-key INSTANCE_SERVICE | PSK 只认证 Core；关系与 Check 才表达业务权限（SF-SPZ-03）。该 PSK 必须以环境变量或文件投递给 `spicedb serve`，不得作为命令行 flag：旧基线启用 tracing 时命令行参数会随 OTel resource 导出（SF-SPZ-04） |
| Core/Application Worker → Temporal | JWT system/namespace INSTANCE_SERVICE | 必须显式启用 default mapper/authorizer，禁止空配置 no-op；Server role 只保护 application namespace，Tenant/Workspace/Resource 仍由 immutable input 与 Admission 约束（SF-TMP-06） |
| Core → AgentGateway admin | SS-AGW-ADMIN 的 INSTANCE_SERVICE | 当前 router 无认证，且同一平面含覆写配置文件的 `POST /api/config`、改监听端口/TLS 的 `llm.settings`/`mcp.settings` 与关停进程的 `quitquitquit`；接缝未闭合时 ConfigResource/log/admin 不得 active |
| Core → OpenMeter | SS-OMT-AUTH 的 INSTANCE_SERVICE | 固定 default namespace 与 Tenant Customer；不接受自报 namespace/customer/subject（SF-OMT-05/06） |
| Core/Worker → remote adapter | ApplicationBinding 的 ServicePrincipal audience + 短期 ActionToken | adapter 校验 exact release/generation/scope并 fresh PEP；token 不能替代 initiating HUMAN/Agent 的 SpiceDB 决策 |
| remote adapter → Cells/WeKnora/Wren native service | ApplicationBinding 的 Tenant/instance service identity | credential 只决定固定 native scope，不能扩大 ActionToken；Cells WOPI PAT 另由 SS-CEL-WOPI 投影 Platform Human/session。WeKnora 侧 API key 必须携带非空 capability（写入需 `ingest`），KB 访问以 WeKnora 显式 grant 模型判定，切换执行 tenant 不授予任何权限（SF-WEK-02/10） |
| Cells WOPI PEP → Core | 该 Tenant Cells binding 的 INSTANCE_SERVICE（凭据按 DD-70/71），audience 固定为 Core WOPI PEP 受众 | 这是 Core 的入站 service 边，与 Core→Cells 反向；请求固定 `{document_session_id, node_uuid, wopi_operation, binding_id}`，响应固定 `{decision, platform_human_id, display_name, admitted_mode, min_zed_token}`。继承父 operation，不新建 Action/Workflow/Quota；PEP 不可达或超时一律拒绝（`18` §5.2、SF-CEL-12） |
| AgentGateway → Wren | SemanticModelVersion 的 RESOURCE_INSTANCE target identity | Browser 与 Agent 不直连 Wren；Core 也只经 AgentGateway 作为 MCP client 到达 Wren，不直连其 `/mcp`。Wren 的 FastMCP Streamable HTTP 端点在固定 commit 上没有任何认证（SF-WRN-06），因此每个 SemanticModelVersion runtime 必须部署在只有 AgentGateway 可达的网络边界内（回环或专用网络命名空间），该网络隔离是 binding `ACTIVE` 的前置条件；一个 runtime 固定一个 version |
| Codex/WeKnora → AgentGateway | `llm_route` 关联的受限 gateway identity | apiKey/JWT user/group 必须映射已登记 Tenant/Workspace ServicePrincipal；禁止跨 Tenant 共享调用 credential（SF-AGW-08）。Gateway 侧 MCP 认证的 `audiences` 由 Core 显式投影为非空列表，上游省略即关闭校验（SF-AGW-11） |
| Materialization runner | Core 内部 SERVICE actor | 只能执行 binding/version 已准入的 pipeline；不是 source/target/binding owner。向 WeKnora 写入时以目标 ApplicationBinding 的 API key 出示 `ingest` capability 与 Editor grant，不借用 HUMAN 身份（SF-WEK-10） |

ServicePrincipal 只承担机器调用和审计归因，不能成为 Resource/Asset/MaterializationBinding accountable owner。跨异步边界保留 initiating HUMAN、acting Agent/Service、Tenant、Workspace、operation 和 trace；组件 payload 中的 tenant/user 字段必须与 binding 重新核对，不能反向成为身份权威。

上述 native authentication 与平台业务 authorization 是两层串联门禁，不是替代关系。SS-AGW-ADMIN、SS-OMT-AUTH 未闭合时，对应组件链不得 active；OpenBao 的 service token 同样只认证 Core/Worker（DD-70）；不能用“仅内网”把未认证管理 API写成已统一认证。

## 2. Tenant/Workspace 投影状态

状态枚举及正常转移由 `03` §2 定义；本节只定义 Buzz 投影的进入条件与协议动作。

- Tenant 与 Community、Workspace 与 Channel 各一对一（SF-BUZ-01，DD-01）。Thread 是会话结构，不是 Workspace。
- `ACTIVE` 要求 Core 事实、SpiceDB relationship 与 Relay roster 查询结果一致。只发出 admin event 而未查证不得 active。
- Relay roster 只有在部署开启 `require_relay_membership` 时才是门禁：默认关闭时 `check_relay_membership` 直接返回 open relay，所有已认证调用方一律放行，roster 行只是展示事实（SF-BUZ-26）。因此 `TenantBuzzBinding` 进入 `ACTIVE` 的前置条件包含 Core 已校验并记录该部署 `require_relay_membership=true` 且 `allow_nip_oa_auth=false`（后者允许不在 roster 中的 pubkey 凭 owner attestation 通行）。两项任一不满足时，撤权只能依赖 Core `REVOKING` 与 SpiceDB，Relay 侧不得登记为门禁。
- TenantMembership/WorkspaceMembership 都是 Core 成员事实，不从 relay/Channel roster 反向推断平台成员。撤权时先 `REVOKING` 并关闭相应 BFF session/stream/Admission，再撤 SpiceDB 和 Buzz 投影；投影失败保持 fail closed，对账闭合后才 `REVOKED`。TenantMembership 还必须在非 Tenant 销毁场景下完成 Resource/Asset owner 转移（DD-41/45）。
- Community 创建为 `ADAPTER_REQUIRED`（SS-BUZ-OPERATOR）：`TENANT_LIFECYCLE` 取得 Platform Catalog Tenant 的 active RelayOperatorIdentity，签名目标必须精确等于登记的 `relay_operator_api_origin + /operator/communities`，由上游 replay guard 验证。创建成功后 Relay-level roster 用 Tenant CONTROL 的 9030/9031/9032，Channel roster 用 9000/9001（SF-BUZ-04/05/06）。
- `BUZZ_PUBKEY_ALLOWLIST=false` 是一期固定部署值，以 `relay_members` 为 Relay 准入表。若某部署选择开启 allowlist，BuzzIdentityBinding 的 `RECONCILING` 必须先写入并查证该 pubkey 的 allowlist 行，不能直接转 `ACTIVE`（SF-BUZ-27）。
- 投影不一致时 Core fail closed：隐藏 scope、关闭 stream、拒绝新写入，不以 Relay 局部成功推断平台权限。

## 3. 消息写入与读取

### 密钥托管按端确定

托管模型是 Client Surface 每端的属性，不是全局前提。它只决定谁持钥、谁签名，不决定治理结论。

| 端 | 私钥位置 | 签名方 | Relay 传输 | `BuzzIdentityBinding.secret_ref` |
|---|---|---|---|---|
| Buzz Web | 不存在于客户端 | Core | 经 BFF transport（`SS-WEB-RELAY`） | 非空，指向 OpenBao |
| Buzz Desktop | 本机 OS keyring（`SF-DSK-02`） | 客户端进程 | 客户端直连（`SF-DSK-01`） | 空 |
| Buzz Mobile | `FlutterSecureStorage`（`SF-MOB-01`） | 客户端进程 | 客户端直连（`SF-MOB-01`） | 空 |

Web 采用服务端托管的唯一理由是浏览器没有安全的持钥方式；该理由不适用于原生端，不得据此要求原生端交出私钥。

由此固定三条边界：

- **协作数据平面的准入执行点是 Relay，不是 Core。** Relay 依自身源码顺序校验 signer、scope、membership 和 kind（`SF-BUZ-03/07`），`require_relay_membership=true` 是它成立的前提（`SF-BUZ-26`）。上游的 NIP-29 权限比 Kailo 宽（`SF-BUZ-37`）：非成员可读写非 private Channel，成员可自建 Channel、自加入与加人。因此还需 `SS-BUZ-GOVERNANCE` 让 Relay 只接受 CONTROL 签发的管理类事件，并以 private 建立 Workspace Channel（`DD-80`）——否则原生端可以绕开 Workspace 成员关系。原生端本地签名后直接发布，Core 不在这条路径上，因此不得声称对原生端消息做过发布前 admission。Web 的「发布前 fresh admission」来自 Core 代签，是 Web 的附加能力，不是三端共同承诺。
- **管理平面三端一律经 BFF。** 审批、云盘、知识库、智能问数、Agent、工具、额度、计费、审计与全部 Governed Action 都走 BFF over HTTPS，身份来自 OIDC 投影，与持钥方式无关。原生端不得以持有 Nostr 私钥为由绕过任一管理平面准入。
- **撤权收敛不依赖持钥方。** 按 `10-授权审批与撤权一致性.md` §4，执行点是 SpiceDB relationship 与 Buzz relay/Channel roster；roster 移除后 Relay 拒绝该 pubkey，与私钥在谁手里无关。`secret_ref` 为空的 binding 不适用密钥轮换流程中依赖 Core 停止签名的步骤，其等价收敛手段是 roster 移除加已知连接关闭。

### 原生端的认证入口与设备公钥登记

原生端没有浏览器 cookie 会话，管理平面以 OAuth 2.0 for Native Apps（RFC 8252）进入：授权码 + PKCE，经系统浏览器登录、以本机回环地址接收回调，向 IdP 取得访问令牌，再以 Bearer 调用 AgentGateway 上**专供原生端的 listener**（DD-78）。该 listener 与浏览器 listener 同样在 gateway 阶段完成认证、清洗外来身份 header 并只投影 issuer/subject，区别只在认证方式：

- 用 `jwtAuth`，模式必须是 `strict`、`audiences` 必须非空；上游缺省的 `optional` 放行无令牌请求，省略 audience 即关闭 audience 校验（SF-AGW-24、SF-AGW-11/19）；
- 令牌校验后从请求中移除，不转发给 BFF（SF-AGW-24）；
- 额外投影一条 `x-kailo-client-surface=native`，浏览器 listener 无条件移除同名 header。BFF 据此区分只对原生端开放的入口，而不是信任客户端自报。

BFF 在两条 listener 之后是同一个服务，身份解析、PlatformSession、准入与审计完全相同；原生端不因持有 Nostr 私钥而获得任何额外的管理面权限。

原生设备首次加入某 Tenant 时，在本机生成密钥对并向 BFF 登记公钥（DD-79）：

1. 请求只接受原生 listener 投影的身份；Buzz Web 没有登记入口。
2. 请求体携带以该私钥签名的 NIP-98 事件：`kind 27235`，`u` 为登记端点、`method` 为 `POST`，并带上调用方**当前 PlatformSession ID**；时间偏差不得超过部署登记的窗口。绑定会话使得截获的持钥证明无法被他人在自己的会话里重放，从而无法把别人的 pubkey 登记到自己名下。
3. Core 校验签名与上述字段后建立 `custody=CLIENT`、`RECONCILING` 的 binding，启动 `BUZZ_IDENTITY_PROJECTION` 把该 pubkey 投入 relay roster 与此人全部 ACTIVE Workspace 的 Channel roster；全部查证后置 `ACTIVE`。超过设备上界是 `LIMIT` 类的确定拒绝。
4. 撤销一台设备：binding 进入 `REVOKING`，同一 kind 把该 pubkey 从全部 roster 移出后置 `REVOKED`。成员撤权则由 `MEMBERSHIP_REVOCATION` 移出此人的全部 pubkey。

### 人类/Agent 正常 event（Buzz Web 路径）

以下六步仅描述 Buzz Web。原生端的协作 event 在客户端完成第 3 至 4 步的等价动作后直接进入第 5 步。

1. AgentGateway OIDC policy 校验 cookie 中 ID token；同一 listener 上的 gateway 阶段 transformation 无条件删除外来 `Proxy-Authorization` 与 Browser 自报的其它 `x-kailo-*` 身份 header，并仅用两条 set 写 `x-kailo-oidc-issuer=jwt.iss` 与 `x-kailo-oidc-subject=jwt.sub`。这两个目标不得再列入 remove；禁止投影 `jwt.rawToken`、其未脱敏形式或任何角色 claim。CEL 求值失败会删除目标 header，BFF 对任一缺失固定拒绝（SF-AGW-17/20/22、SS-AGW-OIDC、DD-73）。挂在 listener 而非各条 route 上是强制的：route 内联 OIDC 的 cookie 名由 route key 派生，多条 route 各持互不相认的会话，登录无法跨 route 完成；且 gateway 阶段先于选路执行，新增 route 不可能绕开这次清洗（SF-AGW-22）。
2. BFF 只从该内网 header 解析 HumanIdentity/TenantMembership/PlatformSession；Browser 经 SS-WEB-RELAY 定义的 BFF transport 提交类型化 query/stream/semantic command/media request，不提交可信 principal、私钥、pubkey、raw signed event 或任意 Relay filter。
3. Core 构造 ExecutionContext，做 Action Admission 并固定 event kind/content/tags 摘要。
4. Core 从 `private_key_secret_ref` 获取该 Principal 的 key 并对 event 签名，按传输选择认证方式：写入与历史查询走 NIP-98 HTTP bridge，每请求一个签名、无连接状态；只有实时订阅与 WS-only kind（gift wrap、presence update）需要该 pubkey 的 NIP-42 WebSocket 会话。两条路径的 signer guard 相同（SF-BUZ-02/03）。
5. Relay 依自身源码顺序校验 signer、scope、membership 和 kind，再持久/fan-out（SF-BUZ-03/07）。
6. event ID 成为 operation outcome/audit evidence。

`RelayActionSink` 不在这条路径；它生成 Relay-self 签名、author `p` tag 与 `buzz:workflow=true`（SF-BUZ-09）。普通 `p` tag 仍是 mention，不作业务 actor 凭据。

### 读取与 Agent 触发

BFF stream 只向当前 active scope 转发 Relay event。Agent dispatcher 以 Relay 持久查询和 Core checkpoint 恢复（SF-BUZ-07）；ACP `BgState/EventQueue` 仅在内存（SF-BUZ-08），不作业务可靠队列。

Browser 不直连 Relay 也不持有 signer。这一边界同时覆盖消息、presence、typing、profile、roster、invite、inline media 和 Agent/inbox 查询；它不是单独的发消息 endpoint（SF-WEB-04/05、SS-WEB-RELAY）。该边界只约束 Buzz Web；Buzz Desktop 与 Buzz Mobile 按上文托管表直连 Relay，其读取路径同样不经 BFF stream。

原 NIP-44 kind:30078 收藏/静音/已读同步在 Buzz Web 上固定由 Core CollaborationUserState 取代，理由是不在服务端保留用户解密私钥（DD-40）。该理由不适用于原生端——它们本地持钥，自身即可解密。原生端的收藏/静音/已读仍以 Core CollaborationUserState 为唯一权威，以保证三端一致与可撤权，但这是一致性要求而非密钥要求；原生端不得另建第二份用户状态权威。

### BFF Relay 连接模型

- 每个 TenantBuzzBinding 在 `ACTIVE` 前抓取 NIP-11，按 `03` 的 digest 规则保存 snapshot digest。BFF 使用该快照与自身更严格配置的交集，不把 1024 subscription、10 filters/REQ、1000 limit、512 KiB frame 当作可超越的建议值；Workspace scope 的订阅必须合并在单 REQ 不超过 10 个 filter，分页 limit 不超过 1000（SF-BUZ-28）。
- NIP-42 会话必须在 5 秒内完成 AUTH；单 event content 不超过 256 KiB，签名 `created_at` 与 Relay 的偏差不得超过 900 秒。默认总连接上限 10000 与 `RateLimitConfig` 的人类/Agent tier 限额作为容量输入，不能靠无限增开每 Principal 连接绕过（SF-BUZ-28）。
- NIP-11 digest、抓取时间与实际 Relay origin 属于 binding fact；三者不一致时进入 `RECONCILING` 并关闭新 stream，不能沿用未验证的旧上界。

## 4. 建立与撤销原子性

| 变更 | 对外开放顺序 |
|---|---|
| 新 Tenant/Workspace | Core 事实+ActionExecution → `ComponentTaskWorkflow(kind=TENANT_LIFECYCLE\|WORKSPACE_LIFECYCLE)` → SpiceDB → Buzz 投影 → 查证 → navigation active |
| 暂停/恢复 Workspace | Tenant scope Governed Action → Core scope fail closed → `WORKSPACE_LIFECYCLE` → Channel archive/unarchive + projection 对账；不调用 DELETE_GROUP，不删除 Resource/Asset |
| 新 Tenant/Workspace member | Core Membership `PROVISIONING`+ActionExecution → `ComponentTaskWorkflow(kind=MEMBERSHIP_PROJECTION)` → SpiceDB → Buzz relay/Channel roster → 查证 → session/stream active |
| 撤 Tenant/Workspace member | Core `REVOKING`/Admission deny+ActionExecution → 关 session/stream → `ComponentTaskWorkflow(kind=MEMBERSHIP_REVOCATION)` → owner gate、SpiceDB revoke、Buzz relay/Channel roster remove → 查证 |
| key revoke/rotate | 停新签名 → 关已知连接 → 生成新 pubkey 与新 binding version（Relay 身份即 pubkey，换私钥必然换 pubkey）→ 以 9031/9001 移除旧 pubkey 的 relay/Channel roster 行、以 9030/9000 加入新 pubkey 并查证 → 旧 binding 保留 `REVOKED` 历史版本供审计解析已发布 event → 重开。CONTROL 轮换另需 Community owner 转移（带 expected-owner CAS），AGENT/CONTROL 轮换固定使该 Installation 的 AgentMemoryBinding 进入 `ERROR`：NIP-AE 的 `d` 标签由双方密钥派生，换任一侧即换掉整个 namespace 且旧密文不可解（`19`） |

中间状态只允许收紧，不使用补偿步骤临时放宽访问。

建立/撤员的 Workflow input 固定 `TENANT|WORKSPACE` target type、Membership ID/version、Tenant/Workspace/Principal 和当前投影 refs；重试复用同一 workflow ID。Core 的 fail-closed 状态定义与多投影收敛 Workflow 均为 `DESIGN_DEFINED`（DD-69）。

## 5. 登录、注销与生产门禁

- AgentGateway OIDC client、登录、PKCE、nonce/CSRF、ID-token 校验和加密 HttpOnly cookie 为 `UPSTREAM_SUPPORTED`（SF-AGW-10）。
- OIDC session cookie 名必须以保留前缀 `agw_oidc_` 开始，确保代理在转发 BFF 前剥离；编码后 cookie 值不得超过 3800 字节，该值是 IdP binding 的 ID-token claim 预算。默认 TTL 3600 秒仍受 ID-token expiry 上限约束（SF-AGW-18）。
- Gateway 本地 cookie logout route 为 `UPSTREAM_SUPPORTED`：只接受同源 `Origin` 的 POST，清 session 与 transaction cookies，并以 303、`no-store` 返回（SF-AGW-10）。claims→BFF header、logout 成功后同步撤销 Core PlatformSession 与关闭 BFF stream为 `ADAPTER_REQUIRED`，精确改动面为 SS-AGW-OIDC。当前源码不保存 access/refresh token，也不调用 IdP end-session/revoke；不得宣称 IdP 全局单点注销。
- CORS preflight 在 OIDC 前执行且被 OIDC 跳过。BFF 对任何缺少已验证 issuer 或 subject header 的请求固定拒绝且不执行 Admission，包括 OPTIONS；Gateway CORS policy 不构成平台认证（SF-AGW-18）。
- 自动 Tenant onboarding 不从 IdP claim 推导；首次已认证 Human 只有在已有 invitation/provisioning fact 时建立 TenantMembership，否则保持 authenticated-but-unassigned。
- OIDC client/cookie secret 与 Nostr key 按 DD-70/72 托管于 OpenBao；Web 登录后的业务链和 Buzz 写入以 SS-AGW-OIDC 闭合为准（`ADAPTER_REQUIRED`）。
