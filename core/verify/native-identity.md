# 原生端身份链核验

对应 `DD-77`（一人多绑定）、`DD-78`（原生端经网关专用入口以 Bearer 进入）、`DD-79`（设备公钥以
持钥证明登记、`BUZZ_IDENTITY_PROJECTION` 投影），以及 Stage 1 退出门禁中的「外来身份 header、
缺失 header 全部被拒绝」「原生端验收覆盖协作数据平面与管理平面两条路径」。

本文核验的是**平台一侧**：网关入口、Core、Worker 与 Relay 的行为。测试进程扮演原生应用——按
RFC 8252 登录 IdP、在本机生成设备密钥、自己签名直连 Relay。Desktop 与 Mobile 应用本身是各自的
交付物，不由本文证明。

## 2026-10-04 开发组织 IP 改址

- 权威：DD-75/78 要求原生端本机持钥直连；DD-114 保留 Host 对 Community 的唯一绑定与 NIP-11 查证。Buzz 固定 `779af8886caae1317b4de962082429867ab61503` 的 `crates/buzz-core/src/tenant.rs::relay_url_authority/normalize_host` 原生接受 IP 与非默认端口，不要求 DNS 名称。
- 影响：只调整 Relay 发布地址与当前业务组织的两个 host 字段；不改协议、契约、工作流 kind、成员、设备密钥、Community/Channel ID 或签名历史。Web 仍走 BFF，原生端仍直连，无第二条身份路径。
- 副作用与边界：新 authority 必须在两库均无冲突；创建 Workflow 已 TERMINAL，不重跑旧 provision。事务断言原 host、ID、版本与状态，条件不符回滚。迁移中失败不报 ACTIVE，原对账器查证 NIP-43、self 和上界后才恢复。未知 Host/匿名请求继续拒绝。旧草稿留本机旧地址桶，不宣称自动迁移。
- 迁移前：Relay 只绑宿主回环，LAN health 为 curl 7/HTTP 000。当前组织 33 条事件没有旧域名正文或 tag 引用，因此没有改写签名媒体引用；NIP-AE 密钥派生与读取不依赖 Host（同固定 Buzz 的 `crates/buzz-core/src/engram.rs::conversation_key/d_tag`）。
- 运行操作：先沿原 Compose 单服务重建发布地址，保持镜像 `sha256:d42f83fa0dadcd78c4ad721047433a9a7c8e522767edd96cb326d641c5dd0056`；不构建、不拉取、不清 orphan。其余 133 个已有容器的 ID/image/StartedAt 前后不变。
- 同一维护 operation `1be55225-2174-48f9-940f-636f53b7e0b0` 先记录 INTENT，再将 Community `c0de7b7b-20b6-4f72-813c-d0f53c589dda` 的 host 与 Tenant `6179e160-6055-4e9a-ae63-1793509c230c` 的 binding 改为 `192.168.0.193:8090`。Buzz 事务确认除 host 外该行摘要一致；Core 经 RECONCILING/version 3，于 09:43:29 UTC 由原对账器恢复 ACTIVE/version 4，随后追加维护查证回执。
- 新 IP NIP-11 的 self 仍为 `069f93ec989725fdc2309f1673e2a5c0201161a3f3e257816afb543bd2767462`，广告 NIP-43、auth_required=true；新 IP 匿名 query 401、旧 Host query 404。IP WebSocket 握手 101，探针主动 2 秒结束返回 curl 28/收到 79 字节，不冒充 NIP-42 认证通过。
- 原生事实仍由 ACTIVE binding 和原 `ws://{host}` 模板生成，即 `ws://192.168.0.193:8090`；客户端需重新登录读取，设备密钥不重发。未进行 Windows 登录、发消息或本机草稿迁移验收，不宣称完整桌面已可用。
- Compose 与容器对比原件：`/volumes/data/kailo/tmp/codex-relay-native-publish-20261004.RgOLgJ/`。改址本身不要求客户端重打包；同批工具 UI 的新 Win11 包及完整阶段检查另行记录，不混为此次改址验收。

## 入口

| 请求 | 结果 |
|---|---|
| 原生入口，不带令牌 | 网关 `401`，不到 BFF（`jwtAuth` `mode: strict`，`SF-AGW-24`） |
| 原生入口，伪造令牌 | 网关 `401` |
| 原生入口，PKCE 取得的访问令牌 | 令牌 `aud=kailo-bff`、`azp=kailo-native`；BFF 解析出与浏览器入口相同的 Tenant 与会话 |
| 浏览器入口，自报 `x-kailo-client-surface: native` | 网关移除该 header，BFF 回 `NATIVE_SURFACE_REQUIRED`（真实浏览器走查实测） |

最后一条的反向实测：把 `x-kailo-client-surface` 从浏览器 listener 的移除列表拿掉并重建网关，
走查在该步失败，回应变为 `CLIENT_KEY_PROOF_INVALID`——header 穿过了网关、BFF 越过了入口检查。
两个 reason 因此能区分「网关移除了它」与「它到达了 BFF」。

## Community 连接事实

原生端本机持钥直连 Relay（`DD-75`），需要知道连到哪里；Buzz Web 永远拿不到这个地址（`DD-39`）。
`GET /api/v1/native/community` 只对原生入口开放，返回该 Tenant 的 Community host 与由
`BUZZ_RELAY_NATIVE_URL_TEMPLATE` 代入它得到的 Relay 地址。Relay 按连接的 Host 绑定 Community
（`SF-BUZ-32`），且只把 `:80`/`:443` 视为默认端口、其余端口算作 host 的一部分（`SF-BUZ-41`），
因此地址的 authority 必须就是 Community host——集成测试断言这一点。Relay 对外用非默认端口时，端口
写进 `BUZZ_COMMUNITY_DOMAIN`，Community host 本身就带着它。

| 请求 | 结果 |
|---|---|
| 原生入口 | `200`，`relayUrl` 的主机名等于 `communityHost` |
| 浏览器入口 | `403 NATIVE_SURFACE_REQUIRED` |
| 模板不含 `{host}` 时启动 Core | 拒绝启动：固定地址会把所有 Tenant 连到同一个 Community |
| 模板在 `{host}` 旁另带端口时启动 Core | 拒绝启动：客户端发出的 Host 与 Community host 不等，Relay 回 404 |

## 设备公钥的完整生命周期

`core/crates/kailo-core/tests/native_client.rs`，在本地拓扑上从头走到尾：

| 步骤 | 结果 |
|---|---|
| 浏览器入口提交登记 | `403 NATIVE_SURFACE_REQUIRED` |
| 持钥证明绑定别人的会话 | `403 CLIENT_KEY_PROOF_INVALID`——截获的证明不能在他人会话里重放 |
| 持钥证明的 `method` 不是 `POST` | `403 CLIENT_KEY_PROOF_INVALID` |
| 持钥证明超出时间窗 | `403 CLIENT_KEY_PROOF_INVALID` |
| 合法登记 | `202 RECONCILING`，`BUZZ_IDENTITY_PROJECTION` 投入 relay 与 Channel roster 后 `ACTIVE` |
| 同一设备重复登记 | `200 ACTIVE`，不起第二条 Workflow |
| 成员页 | 同一人名下两把公钥：Web（SERVER）与该设备（CLIENT） |
| 设备以自己的私钥**直连 Relay** 发布 | 被 Relay 接受 |
| 在浏览器入口撤销该设备 | `202 REVOKING`，Workflow 移出全部 roster 后 `REVOKED` |
| 撤销后设备再直连 Relay 发布 | **Relay 拒绝**——执行点是 roster，不是 Core 停止签名（`DD-75`） |
| 同一人经 Web 发布 | 仍成功：只撤了那一台 |
| 已撤销的公钥再次登记 | `409 CLIENT_KEY_ALREADY_BOUND`：撤销的身份不复活 |

## 直连 Relay 不等于能治理

设备持钥直连 Relay 之后，上游宽松的 NIP-29 权限就成了它可直达的旁路（`SF-BUZ-37`）：
自建 Channel、自加入别的 Workspace、读写非成员 Channel。Relay 以 `SS-BUZ-GOVERNANCE`
只接受成员发布 `BUZZ_MEMBER_EVENT_KINDS` 里的 kind，其余只收 Tenant CONTROL 签发，
Channel 一律 private（`DD-80`）。上面的生命周期里，已登记的设备能直连发消息，但自建
Channel 被 Relay 拒绝。逐项核验见 `upstream/buzz/kailo/verify/governance.md`。

## 与撤权并发时不留下已撤销的钥匙

设备投影与成员撤权可能交错。设计固定两件事：撤权一方先把状态置为 `REVOKING`（成员或设备）
再动 roster；设备投影每次投入之后都回头核对这两个状态，发现撤权已开始就把刚投入的移出；置
`ACTIVE` 与「成员仍 ACTIVE」在同一条 SQL 里判定。由此任何交错下都不会留下一把已撤销却仍在
roster 上的钥匙（`core/crates/kailo-core/src/identity_projection.rs`）。

## 数据模型

`20260923040000_buzz_identity_multi_binding`：`buzz_identity_binding` 改以 `pubkey` 为主键；每人
至多一条非 `REVOKED` 的 SERVER binding（部分唯一索引）；CLIENT binding 只能是 HUMAN（CHECK）。

- 前进、回退、再前进三步演练通过（`tools/check.sh migrate`）。
- 同一人有两条 binding 时回退被拒绝：删掉其中任何一条都等于替用户撤掉一台设备。
- 尝试写入 CLIENT 托管的 CONTROL 被约束拒绝。

成员投影改为覆盖此人**全部** pubkey：建立方向投入 ACTIVE 与登记中的钥匙（撤销中的不重新加回），
撤权方向移出全部非 REVOKED 的钥匙。Web 取签名密钥时只取 SERVER 那一把——多把之后再按「第一行」
取，可能取到设备的公钥而让 Web 发布被拒。

## Web 托管身份的终态重发（2026-09-27）

`server_keys::resume` 对已经驱动过 `BUZZ_IDENTITY_PROJECTION` 的同一
`ActionExecution`，先核对原准入仍为 `ALLOWED`、Tenant、目标 HUMAN Principal、
SERVER binding 和 WorkflowRef 归属。原 WorkflowRef 已 `TERMINAL` 时只返回固定
Workflow ID（`runId=null`），不再次 Start 已终结的 ID；返回引用不表示业务成功，
终态仍以 TaskProjection/Temporal 事实为准（DD-48、DD-77）。撤销请求中附带的
pubkey 还必须与原 Workflow ID 冻结的 pubkey 相同。

本地 Core 镜像在 `kailo-core-limited-20260925` BuildKit（16 GiB、5 CPU）与
外层 2 GiB、1 CPU cgroup 中重建，manifest 为
`sha256:5f49214d987d0fd3cd9b8d3e69df85c7cdb352edcbe2404433e3da4352c52558`；
`start-core.sh` 重投一次性凭据后 `/healthz` 返回 200。真实 Core、Temporal、
Relay、OpenBao 链路的 `cargo test -p kailo-core --test server_keys` 在
12 GiB、4 CPU cgroup 中通过 1/1：撤钥与重建各自在 WorkflowRef 终结后重发，
均返回原 ID、空 run ID，旧钥匙仍被 Relay 拒绝，新钥匙仍可发言。临时把首个
终态重发断言改为期望 409，同一测试以实际 200、退出码 101 失败；恢复断言后
再次通过 1/1。`cargo check -p kailo-core --all-targets` 在 8 GiB、4 CPU cgroup
中退出 0；没有 schema、API 或 Workflow input 变更。

这只闭合内部 service API 的终态幂等重发。测试通过直接插入的夹具
`ActionExecution` 驱动托管身份 revoke/provision；用户可达的两条 Governed Action、
以及已失败 `BUZZ_IDENTITY_PROJECTION` 的受权重跑入口仍未交付，不能把本段证据
当成托管身份轮换的完整产品验收。

## Web 托管身份的动作类型隔离（2026-09-28）

内部 revoke/provision service 入口现在分别要求已准入 `ActionExecution.action_key`
精确为 `identity.key_revoke` / `identity.key_provision`；首次执行和
同键重发都核对动作类型、Tenant、目标 Principal 与 WorkflowRef 归属。此前仅核对
`ALLOWED`、Tenant 与目标 Principal，另一种已准入动作能借此入口触发密钥副作用。

本地新 Core 镜像经受限 BuildKit（16 GiB、5 CPU）重建后，
`core/verify/run-integration.sh` 在外层 16 GiB、5 CPU cgroup 内退出 0：
真实 `server_keys` 用例 1/1，携重建动作请求撤销得到 403 且旧 binding 保持
`ACTIVE`；携撤销动作请求重建得到 403；随后各以正确动作分别撤销、重建，
原 Workflow 终态重发仍只返回固定引用。错误动作对象就是反向破坏探针，
恢复为正确动作后完整链路继续通过。全套 Rust/Go 集成核验结束后，本轮 19 个
测试 Tenant 的 OpenBao namespace 离线清理，前后集合一致，本地 Core 恢复健康。
`tools/check.sh --full` 十组通过；未提供隔离 `DATABASE_URL`，迁移实演为 SKIP。

这仍是内部 service 边界的证据：测试夹具直接插入准入记录，尚未证明两条
ActionDefinition、BFF 提交入口、Web 交互和搁浅投影受权重跑。不得据此关闭
Stage 1/2 的托管身份轮换验收。

## SERVER HUMAN 私钥写入意图的隔离核验（2026-09-28）

首次 `MEMBERSHIP_PROJECTION` 建钥与 `identity.key_provision` 重建共用
`admission.server_key_provision_intent`：先按 ActionExecution 冻结 Tenant 内唯一 KV locator，
同一 Principal 的未完成意图由部分唯一索引互斥；再以 KV v2 `cas=0` 写入，读回版本 1
推导公钥，最后把 binding 与意图结束标记原子提交。重建路径同一事务预写
`BUZZ_IDENTITY_PROJECTION` WorkflowRef；成员初建的 `MEMBERSHIP_PROJECTION` WorkflowRef
在建钥前已存在。意图只追踪“私钥写入到持久绑定”，不代表 roster 已收敛或 binding 已
`ACTIVE`；后两项仍由对应 WorkflowRef、Activity 和既有投影对账负责。

定向验证结果：受限 `cargo check -p kailo-core --all-targets` 与
`cargo test -p kailo-core --test server_keys --no-run` 均退出 0；
`kailo-secrets::deterministic_write_recovers_lost_response_without_appending_version`
在模拟 OpenBao 已落盘但响应丢失时通过 1/1，确认只发一次 POST、以已存在版本 1
恢复、不同值被拒绝。隔离数据库 `kailo_server_key_verify_20260928` 完整应用 24 个迁移，
最新迁移回退后再前进成功；事务内确认同一 Principal 第二条未结束意图被唯一索引拒绝、
非法成员来源形状被 CHECK 拒绝、已结束意图释放互斥约束、未结束意图阻止删除其
ActionExecution，事务回滚后意图行数为 0。隔离数据库与共享 `kailo_core` 不互用。

共享 Core 未重启，故本段**不证明**真实 HTTP/Workflow 下的同 Action 并发重放、两入口
竞争、成员撤权或 Tenant 暂停恰在 OpenBao 写入期间、KV 版本异常，以及写入成功但 DB
提交失败后的周期重驱。上述链路仍须用新 Core 镜像、真实 Temporal/Worker/OpenBao
和定向故障注入核验；编译与数据库约束不能替代这些终态证据。

升级兼容追加核验：固定 WorkflowRef 与原 SERVER binding 均存在的旧版
`identity.key_provision` Action，即使仍为 `ALLOWED/NOT_DISPATCHED`，也只按原引用恢复；
binding 的 SecretRef 需读回原私钥并匹配 pubkey，最终派发状态须在同一事务内锁定
ActionExecution、目标与发起人成员、Tenant 和原 binding 后转换。对
`ALLOWED/UNKNOWN` 且无 intent、无身份投影固定 WorkflowRef 的历史行，入口拒绝补写 OpenBao，
治理对账单列 `kailo.server_key_provision.orphan_unknown` 告警。在独立数据库
`kailo_server_key_legacy_verify_20260928` 上，24 个迁移应用后用回滚事务构造旧
WorkflowRef/binding：原引用查证得到 1 行、锁定条件返回 `NOT_DISPATCHED`；无引用
UNKNOWN 的写前 UPDATE 影响 0 行且告警查询得到 1 行；成员置 `REVOKING` 后锁定
条件返回 0 行。事务回滚后业务表均为 0 行，最新迁移 down 通过，隔离库已删除。
这只证明 SQL 形态与约束，不代替旧数据经真实 Core/Temporal/OpenBao 的端到端重放。

更重要的是：成员撤权、Tenant 暂停或另一条历史 binding 胜出若发生在 KV 版本 1
写入之后、binding 提交之前，当前对账器保留未完成意图并以
`kailo.server_key_provision.overdue` 度量和日志告警；它不会盲删已写入的 secret，也
没有经过治理且经 OpenBao metadata 查证的孤儿版本销毁入口。
预写事务现已在 UNKNOWN/intent 落库前锁定并核验目标、发起人成员与 Tenant；但事务提交后、
OpenBao 调用前的撤权仍可留下 metadata 版本 0 的开放意图。单次观察到版本 0 不能作为
清除依据：并发或在途的写入仍可随后落盘，须有受治理的终结和实际故障演练。平台值班者
可只读查询 `admission.server_key_provision_intent` 中 `finished_at is null` 的行，以冻结 locator
核对该 Tenant 的 KV metadata、ActionExecution 与 binding/WorkflowRef；在缺少受治理的
销毁/终结动作与实际演练证据前，不能手工删意图、换 locator 或宣称成功。这是
Catalog HUMAN 开通与用户可达托管身份重建的**生产阻断**，两入口不得作为已闭合能力放行。

## 治理对账选批纠偏（2026-09-28）

依据 `.design/06` §3.1、`DD-48`、`DD-82` 与 `V-SCN-38`：Core 已预写的动作按原
ActionExecution 和固定 Workflow ID 收敛；结果不明不能靠新动作或新密钥路径重放。
GitNexus 刷新索引后，`governance_reconcile::pass` 的 upstream impact 为 LOW，影响
`spawn` 和 Core `main`；`spawn`、`repair_legacy_catalog` 也是 LOW。
`tenant_bootstrap::ACTION_KEY` 的图风险为 UNKNOWN，文本检索确认它只被该模块的
引导记录与审计引用，故仅将同一常量开放给对账筛选。变更面是 Core 的四个选批查询、
两个只承载轮转时间的可空数据库列与一条部署引导逾期度量；没有新 API、Workflow、
契约字段或三端入口。旧 Core 忽略新增列，可在前进迁移后继续运行；回退迁移只在
新 Core 已停止或回退到旧版后执行，否则新 Core 查询将因缺列失败并停止本轮对账。

原选批按不可变的最老 `created_at`/`updated_at` 取固定 `LIMIT`：持续返回
`PRECONDITION` 或 `PENDING` 的老记录可让其他 Tenant 的健康动作永久得不到机会。
现在按 `coalesce(reconcile_last_attempt_at, 原时间)` 轮转，选中时以行锁和
`SKIP LOCKED` 原子写入尝试时间，不改变业务 `updated_at`、gate/dispatch 状态或
外部结果。旧的失败项仍在队列内，后续轮次继续核查；持续积压由原有 open/overdue
度量暴露。部署引导 `tenant.bootstrap` 没有普通 ActionDefinition，只由引导命令
沿已冻结 Workflow ID 重试；通用派发器排除它，并以
`kailo.tenant_bootstrap.overdue` 单列告警，绝不把该记录当作成功。旧 Catalog 修复
仅检查当前存在的身份、成员、ActionExecution、SpiceDB 与 Buzz 投影；删除了五张
当前迁移未创建的组件表的预建检查。

异常边界沿用原准入与业务状态：`DENIED`/`BLOCKED` 不因轮转开放入口；
`PRECONDITION` 修复前保留未决；`LIMIT` 只影响处理速率，队列仍轮转；
`CONFLICT` 保持原幂等/版本判据；`UNKNOWN` 只按原固定引用查证，既不判成功也不
盲目重放。空队列记录零度量；并发 Core 副本在选批事务内跳过已锁行，提交后若重选
同一行仍须沿原固定 ID 幂等协议；进程在标记尝试后崩溃，
该行在其他候选之后再次进入队列；租户暂停、撤权、密钥版本异常由原驱动器重新准入
并保持原拒绝/待对账结论。轮转时间不是第二份 ActionExecution 权威。

独立库 `kailo_verify_governance_fairness_20260928` 完整应用 25 个迁移，最新迁移
回退、再前进均退出码 0；四个完整选批 SQL 在该库 PREPARE/EXECUTE 成功。
回滚事务中的 `batch=1` 样本，两次通用选批得到不同动作且均不是最老的
`tenant.bootstrap`；两条 OpenBao 写入意图也在两轮各被选中一次。故意把选择恢复为
旧 `created_at` 顺序，公平性断言按预期报错且 `psql` 退出码为 3；恢复后通过。
`cargo test -p kailo-core --no-run` 在 12 GiB/400% cgroup 中退出码 0。
这些证据覆盖 SQL 轮转和编译，不代表真实 Core/Temporal/OpenBao 故障链已闭合；
本文件前述孤儿版本的受治理清理仍是生产阻断。

## 门禁

`tools/check.sh security` 对每个 listener 判定：恰好挂一种认证（`oidc` 或 `jwtAuth`）；OIDC 必须
配 logout；`jwtAuth` 必须 `mode: strict`、`audiences` 非空、不保留令牌；原生入口把
`x-kailo-client-surface` 投影为固定值 `"native"`，浏览器入口必须移除它。六种违规各自破坏一次，
均报出对应条款，还原后逐字节一致。

`tools/check.sh migrate` 的枚举一致性检查在 `workflow_kind` 缺少新 kind 时报出库与契约的差异。

`worker/replay-tests` 录入了设备登记与撤销两份真实 history；在该分支多发一次状态投影即报
nondeterministic。

## IdP 登记（部署前置）

原生端是 RFC 8252 的公开客户端，部署时在 IdP 登记：不发 client secret，PKCE `S256`，访问令牌带
audience `OIDC_NATIVE_AUDIENCE`。redirect 只允许两种：Desktop 的本机回环 `http://127.0.0.1/*`
（§7.3，端口由系统分配），Mobile 的私有 URI scheme `OIDC_NATIVE_MOBILE_REDIRECT_URI`（§7.1，
scheme 随 App 构建固定，部署与 App 构建必须一致）。本地拓扑的 realm 模板
`deploy/local/keycloak/kailo-realm.json` 即按此登记；渲染在进程内完成，secret 不上命令行。
realm 只在 IdP 首次启动时导入，已运行的 IdP 改登记要经管理接口。

## 端到端核验

`core/verify/native-e2e.sh <desktop|mobile> <buzz 源码树>`：两端共用同一个真实 Workspace 夹具与
环境变量，各以自己的代码走完登录 → 设备登记 → `ACTIVE` → 取连接事实 → 直连 Relay 发消息 →
自建 Channel 被拒 → 撤销后被拒 → 注销。Desktop 跑 `src-tauri` 的 `kailo::e2e`，Mobile 跑
`mobile/test/kailo_e2e`。

## 2026-10-03：原生会话异步归属收口

权威沿 DD-75/78/79/96 与现有 `identity.client_keys`、PlatformSession 合同。
本批修正既有登录、设备登记、刷新、退出和 Community 连接的异步归属，
不是新增身份、注册表、权限或工作流。Web/Desktop 继续消费同一个 TypeScript
平台主体；Mobile 仍使用原生 OIDC 与 Relay 路径，没有组件宿主或 WebView。

影响面为共享 `NativeBootstrap`、原生 invoke 传输，以及 Desktop/Mobile 原有
会话与连接实现。每个异步结果只作用于发起时的本机流程；取消、退出、换配置
使旧结果失效，旧会话失效通知不能退出新登录。连接取消还传给原 Desktop
宿主，避免仅忽略界面结果却留下旧连接。本机代际不持久化、不作为服务端
鉴权事实，不改变 schema、BFF API、Workflow history 或数据库兼容性。

副作用仍走原入口：退出冻结该次凭据，远端撤销不得读取或清除后来登录的
凭据；刷新不可达不等于凭据被明确拒绝。未知会话模式不登记设备，受限会话
只挂既有生命周期任务与审批。结果不明保持未确认，不以任意 2xx 冒充注销终态。
并发刷新、迟到成功/拒绝、登录取消、退出中刷新和新登录分别核对归属；
网络/凭据存储失败继续采用原不可达、未登录或 UNKNOWN 分类，不新增业务状态。

共享端先实现后验证：固定检查 SDK 内 `typecheck` 与原平台测试，选定输入
170 项通过；私有副本移除会话失效校验，2 项断言失败，原命令退出 1；
再分别破坏传输通知归属、未知模式拒绝与受限准入，5 项断言失败、退出 1。
逐字还原选定实现后，同一检查再次 170 项通过、退出 0。原件位于
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/native-session-batch.0ZyXoF/`。
离线缺依赖、旧 SDK 网络不可达和快照缺少既有检查输入的失败日志全部保留；
补齐投递后使用相同锁文件与原检查，不改产品代码迁就检查环境。
这不是 Win11/手机设备验收、业务 E2E、安装包或部署完成声明。

Desktop 同批原 `cargo test --locked --lib platform:: -- --nocapture` 为
14 passed / 1 ignored，`cargo clippy --locked --lib --tests -- -D warnings`
和限定源 `rustfmt --check` 退出 0；连接模块 3 项检查通过。私有删除代际
检查与回退 OAuth/注销确认分类分别触发 3 项断言失败、退出 101；连接取消
守卫破坏亦失败，恢复后通过。固定 SDK、限额、原失败和恢复输出保存在
`/volumes/data/kailo/tmp/codex-desktop-session-20261003.uWm6ft/`。
`native-final.log` 的 SHA-256 为
`ebcb46105334c4d7fdc9a9f3affe9763b6128b7c274a3980a0dac3098c5f8e48`；
`native-clippy-final.log` 为
`115262dbd4a4f6ee06c3a8f2ba2781bf78b6734b575e7632309d70587b29dccb`。
明确 ignored 的真实 E2E 没有运行，不以 fake IdP/BFF 断言代替设备或服务验收。

Mobile 最终使用原 Flutter 3.41.7 / Dart 3.11.5 SDK，限定 7 源格式检查与
分析退出 0，31 项通过，1 项需要真实环境的 E2E 明确跳过。五次私有生产
守卫破坏分别触发 1/1/1/6/2 项断言失败、命令退出 1；逐次恢复，最终源码
与正式 7 路径 SHA 全部一致。注销过渡为既有 outcomeUnknown，只有本机凭据
清除成功后才呈现 signedOut；远端未确认不冒充全端撤销。证据原件位于
`/volumes/data/kailo/tmp/codex-mobile-session-lifecycle-20261003.OmU4VS/`，
`delivery-final.log` SHA-256 为
`77e6f91d1cccff96149d9f34f22361c567cce0db7cd07f424e2e3a1fdf43661b`。
本批没有 Mobile 安装包、签名或手机设备验收。

两端沿原 helper、原配方从冻结树
`26afb30cc06176846be2a3656786fe1ba62ae457` 顺序构建，均退出 0。
Web source 为 `e6fe9478955d95079f997432941cc5859f4eada2bd6fdee278c9ce5bfdbe7b7f`，
镜像为 `sha256:7576e989296abaab3de5150f0010187a137467eb843c827743638b57bed3e767`，
registry 读回 HTTP 200，header 与 body 摘要一致。
Win11 x64 source 为 `5a85c94e4be590901cb5fd127bab76c43d7a3ac3b9d973b06ffcde0a0d57eb45`，
`Kailo_0.5.23_x64-setup.exe` SHA-256 为
`336e70ca054dae71b9c0add734c4d25475141fcf25cad23a099e752f0dc6f3f6`。
原件、两次 helper 日志与 NSIS 包在
`/volumes/data/kailo/tmp/codex-desktop-session-web-win-20261003.6ZOd0g/`。
构建明确保留交叉编译、未签名提示；没有安装运行或部署声明。

### 本批提交、全量检查与 Web 实际投递

选定树 `b41cae30df461b3a9adcfdb3b17cec1e75f876e1` 的原
`./tools/check.sh --full` 实际退出 0，末行“全部通过”。原件为上述
`native-session-batch.0ZyXoF/full.log`，SHA-256 为
`f7a12d547abc2a910a8dc751d3baaf2156d8054451dc574d64a785df6f192abd`。
数据库迁移演练因缺 DATABASE_URL 跳过，实际部署配置预检因 SDK 未投递 .env
跳过；未安装 gitleaks，实际执行的是内置扫描。客户端签名/设备发布条件不变。
43 文件、+2610/-318 已提交并普通 push 为
`4dca2f355dcee8df1c563ee6d4871fd81eea474c`，远端 main 独立读回一致。

2026-10-03 22:41 UTC 用该提交的冻结 Compose、实际配置和原 secret 路径，仅替换
buzz-web，未使用工作树其他未提交部署改动。新容器
`d638331c5303c5d1dbc67ebe76a86f1862056a294f8493d5ce91b60848805d24`
使用上述 `7576e989…` 镜像且 healthy；内部 healthz/app 均 HTTP 200，公开匿名
app/session 均 HTTP 302 到既有 OIDC。其余 27 个 Compose 容器的 ID/image 未变，
包括原有两个 OpenMeter orphan；未清理 orphan、未重建、未启动 K8S。
证据目录 `/volumes/data/kailo/tmp/codex-native-session-web-deploy-20261003.su7yLP/`，
`receipt.md` SHA-256 为
`7b6dacfa3db39ffb0b111d8b8b0557a6a05d66665d8fa1c5e27b107ab20731ea`。
此处新增的是 Web 投递和 HTTP 观察，不是浏览器登录 E2E、Win11/手机安装或 Agent 首轮验收。
