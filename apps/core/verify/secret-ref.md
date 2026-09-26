# SecretRef 解析核验

对应 `DD-70` 与 `.design/03` §9：SecretRef 只是 locator
（`<namespace>/<mount>/<path>` + KV v2 版本号 + audience），Core 把它换成内存里的
值，**不写数据库、不写日志、不落盘**。任何 binding 在其全部 SecretRef 指向的版本
可读、且该次读取已被 OpenBao audit 记录前不得 active。

夹具：`core/verify/seed-secret-ref.sh`（写两个版本；只有一个版本时
「取到的正是请求的那个版本」这条断言恒真，等于没验）。

## KV v2 写入 CAS 核验（2026-09-26）

权威为 `.design/02` 的 `SF-OBA-03`、`DD-70` 与 `.design/03` §9。GitNexus 对
`SecretStore::write` 报 LOW，但接收者类型未解析的调用不能据此忽略；文本复核了
`platform_bootstrap` 两处、`tenant_lifecycle` 与 `membership_projection` 各一处写入。
本次只改统一写入封装、现有本地 OpenBao mount 初始化、核验夹具和既有安全门禁；
不改数据库、契约、Workflow 或三端入口。CAS 冲突及未知回应均拒绝写入，不把
结果不明当成版本成功，也不引入第二份 secret 权威。

`openbao-init.sh` 已将 mount 运行期配置为 `cas_required=true` 并回读确认；在本地
运行该脚本退出 0。`SecretStore::write` 先读路径 metadata 的 `current_version`，
不存在时用 CAS 0，再由 OpenBao 在写入时原子检查版本；只接受 OpenBao 返回的版本号。
真实 OpenBao 用例用同一枚受限 service token 写第三版并按该版本读回，1/1 通过。
临时从写请求移除 `options.cas` 后，同一用例得到 `WriteRejected`、退出 101；恢复后
重跑 1/1 通过。临时把部署脚本写成 `cas_required=false` 时，`check.sh security`
明确报错并退出 1；恢复后通过。两处破坏均已还原。

这只闭合写入 CAS 与本地 mount 前置条件；SecretRef 的轮换顺序、旧版本处置和
各消费端投递仍属 Stage 2 的完整生命周期验收，不能由本用例替代。

### 启用 CAS 后的集成夹具收口

本地 Core 已经由 `start-core.sh` 重新构建并以一次性凭据启动，运行镜像为
`sha256:0005b86608c05c616e631edf881f03a22b4d261ca2a6d36c2edb181242912322`，
`/healthz` 返回 200。首次 `core/verify/run-integration.sh` 在
`membership_lifecycle` 的共用夹具 `put_secret` 处退出 101；定向复现稳定返回
OpenBao HTTP 400。该夹具直接 POST 到已要求 CAS 的 mount，却仍发送无 CAS 的
旧请求，不是 Core 的 `SecretStore::write` 回归。GitNexus 对 `put_secret` 的影响为
UNKNOWN，文本核对实际调用者只有 `membership_lifecycle` 与
`membership_projection` 两个集成用例。两者均为本次新建的 Community host，
因此夹具使用 `cas=0`，由 OpenBao 原子证明目标不存在，不覆盖已有版本。
定向 `membership_lifecycle` 从 HTTP 400、退出 101 变为 1/1 通过；重新运行
整个 `core/verify/run-integration.sh` 在 `MemoryMax=16G`、`CPUQuota=500%` 的
cgroup 中退出 0。脚本明确 ignored 的 Relay 故障演练及 Approval
continue-as-new 演练未计入本次结果。

## 值出不去，是类型挡住的

`SecretValue` 不实现 `Debug`/`Display`/`Serialize`，取用必须显式调 `expose()`。
这不只是约定：核验用例最初写的是 `expect_err`，编译器直接拒绝，因为
`expect_err` 要求 `T: Debug`。**连测试代码都没有把 secret 打进输出的口子**，
改成 `matches!` 才通过。

## 实测结果（2026-09-22）

`core/crates/kailo-secrets/tests/openbao.rs` 对运行中的 OpenBao 执行：

| 性质 | 结果 |
|---|---|
| 请求版本 1 与版本 2，分别取到 `v1` 与 `v2` | 通过。不取 latest——binding 冻结的是具体版本，取 latest 会让一次无关的轮换悄悄改变已 active 的 binding 行为 |
| audience 与本服务身份不符 | 通过，`AudienceMismatch`，且在发出任何网络请求之前就拒 |
| 请求不存在的版本 9999 | 通过，`VersionUnavailable`，不是「读到空值算成功」 |
| 策略之外的 mount | 通过，读不到。守的是「凭据的能力等于策略」，不是「代码里没写过那条路径」 |

## audit 确实记录了取用

`DD-70` 要求「该次读取已被 OpenBao audit 记录」。复核 `/openbao/data/audit.log`：
上述取用共命中 22 条 request/response 记录，其中也包括那次越界读取
（`not-a-mount/data/verify/secret-ref`，response 带 error）。

值不在日志里：审计条目中的敏感字段是 `hmac-sha256:...`，明文 `v1`/`v2` 未出现。

## 版本保留不是无限的

KV v2 默认只保留 10 个版本，超出的静默删除。核验夹具每跑一次写两版，跑到第 18
版时最旧可读版本已经是第 9 版——用例断言「版本 1 可读」于是失败。

这不是测试的问题，是一条真实的运维边界：SecretRef 钉的是具体版本，被裁掉的版本
永远读不回来，而 SecretRef 不可读时 binding 不得 active（`DD-70`）。一个还在用的
binding 会因为别处的几次轮换而永久失效。已把 `max_versions` 显式设定写进
`07` §1，并由 `openbao-init.sh` 落到 mount 配置上。

用例也改为断言夹具**本次**写入的两个版本号，不再假设它们是 1 和 2。

## 最小权限

Core 的策略只给登记 mount 的 `create/update/read`（data）与 `read/list`（metadata），
**不给 `delete`/`destroy`**。secret 的撤销是受治理动作，不是运维旁路；真要撤销时
显式扩策略，而不是一开始就把能力留在那里。

AppRole 换取的 token 是短 TTL（20 分钟，上限 1 小时），Core 不持有长期凭据。

## 引导自检失败后的令牌回收（2026-09-26）

`AppRoleSession::connect` 在首次登录后、单次使用自检成功前不再发布 service token 到内存 lease。若 role 错配导致同一 `secret_id` 第二次仍可登录，先以各自的 token 调 OpenBao `PUT auth/token/revoke-self` 撤销额外与首次签发的两枚令牌，再以 `SecretIdReusable` 拒绝启动；首次响应缺少 renewable/有效 lease、或自检请求失败时，同样尝试撤销首次令牌。撤销失败不被吞掉：返回 `RevocationUnconfirmed`，Core 不进入 serving，运维按 RB-02 步骤 C 处置，不能把“请求已发出”当作“令牌已撤销”。

定向 `cargo test -p kailo-secrets reusable_secret_id_revokes_both_issued_tokens`：1/1 通过，模拟可重复登录时观察到两次独立撤销请求和空 lease。临时移除首次令牌撤销后，同一用例以“收到 5 次请求，应为 6 次”失败（退出码 101）；恢复后 1/1 通过。真实 OpenBao 的正常单次投递路径由 `seed-secret-ref.sh` 加 `cargo test -p kailo-secrets --test openbao` 再验，1/1 通过。反向用例验证的是撤销请求与 fail-closed，不把 mock HTTP 200 冒充真实 OpenBao 已撤销的网络证据。

## 启动后失败及停服时的令牌回收（2026-09-26）

Core 在首次平台 AppRole 登录成功后，把后续 audit 登录、audit device 查证、平台引导、其他依赖初始化与服务生命周期纳入同一显式收尾范围。无论哪一步返回错误或正常结束，分别尝试撤销平台 namespace 与 root audit namespace 的当前 service token；没有成功登录的会话不发撤销请求。任一撤销未确认都不能作为正常退出报告，原始错误保留在日志。`revoke_current` 仅在 OpenBao 确认撤销后清空 lease；失败时在当前会话保留令牌，但 Core 退出时没有自动重试，不能把它当作已撤销。Core 进程非正常强杀仍依赖 OpenBao 的短 TTL，不能声称收到撤销确认。

定向 `kailo-secrets` 单测 4/4、现有 OpenBao 集成用例 1/1、`kailo-core` 编译通过。新增单测模拟首次撤销 HTTP 500、再次 HTTP 204，核对失败时 lease 保留、成功后清空且只发两次请求；暂时移除真实撤销调用时该用例退出 101，恢复后通过。真实 OpenBao 的正常 SecretRef 用例再次显式启用并通过 1/1，结束前主动撤销其核验用 token。

另用已构建的 Core 二进制验证启动失败分支：在本地数据库只建立连接，平台凭据使用一次性 response wrapping，audit wrapping 故意设为无效，故障发生在任何平台引导写入和监听之前。Core 退出码 1；日志确认平台 service token 已换出及 audit 凭据被拒；OpenBao audit 中 `auth/token/revoke-self` 记录由 4 增至 6，最后两条分别为 request 与无 error 的 response。没有打印 token 或日志正文，也没有访问旧 K8S。前两次准备命令分别因 Cargo 工作目录和测试环境变量缺失而在登录前退出；其未消费的 wrapping token 由 OpenBao 的 120 秒 TTL 失效，不能算成功的撤销演练。该验证不覆盖 Core 正常 serving 后的外部 SIGKILL，也不证明 OpenBao 不可达时的撤销结果。

受限 BuildKit 构建本地 Core，首个镜像 manifest 为 `sha256:ee3e6dfd5a12c77854bfda6c812d684058d39792c5bc67c61171fdfeb0aa78b6`；`start-core.sh` 重新投递两份一次性凭据并重建 `core-bff`。该镜像上的 `core/verify/run-integration.sh` 退出码 0：真实 OpenBao、Buzz、SpiceDB、Temporal、Core/Worker 集成套件通过；标为 ignored 的 Relay 故障与 Approval continue-as-new 演练未计入。

Docker 的停服信号是 SIGTERM。Core 增加该信号的优雅退出处理后，第二个镜像 manifest 为 `sha256:ef5f05b21f16ea367b2a0ccb5faaa760b91b3bae09b64221b1149645b1677411`。对运行中容器发送 SIGTERM 前，OpenBao audit 的 `auth/token/revoke-self` 记录数为 8；容器退出码 0 后记录数为 12，新增的两组 request/response 均无 error。随后 `start-core.sh` 重新投递一次性凭据并恢复 Core；同一镜像运行中，`/healthz` 返回 HTTP 200。SIGKILL、OpenBao 不可达和容器在撤销中途崩溃仍没有确认撤销的证据，只能依赖短 TTL 与审计对账。

最终 `./tools/check.sh --full` 十组通过；其中实际迁移演练因本次未传隔离 `DATABASE_URL` 为 SKIP，独立隔离库实演证据见 `task-terminal-repair.md`。

## SERVER Buzz 身份的钉版私钥与 pubkey 一致性（2026-09-26）

权威为 `.design/02` 的 `DD-70/72/75/77`、`.design/03` §2 与 §9。此前 signer
只证明 `SecretRef` 指定版本可读，没有证明该私钥属于 binding 登记的 pubkey：
错误引用到另一条可读 KV 版本时，Core 会以另一身份代签。`read_bound_keys` 现在在
Core signer 内读取精确版本、解析 Nostr 私钥并核对派生 pubkey；不匹配、版本不可读、
audience 不符或私钥不可解析都拒绝，不回退 latest 或另一条身份。它只返回内存中的
`nostr::Keys`，不新增 secret 数据权威、数据库列、API 字段或 Workflow kind。

取用点覆盖 Web HUMAN 的消息查询/发布、媒体与订阅，Tenant CONTROL 的 roster
投影及其他管理签名，以及部署级 operator 的 Community 创建签名。SERVER HUMAN
在进入 roster 与 `ACTIVE` 前、CONTROL 在 Tenant binding 开放前、operator 在
引导或轮换的身份行推进前，均对登记的 SecretRef 做同一查证。CLIENT 身份私钥在
Desktop/Mobile 本机，不进入此 Core signer；已 `REVOKING` 的 SERVER binding
仍不能被 Web 取用。失败归于 `apps/06` §4 的 `PRECONDITION`，当前服务/BFF
路径返回 HTTP 503，不把失败伪装成成功或外部结果 `UNKNOWN`；已生效的旧
binding 不在读取失败时自动改写状态，待 secret 修复后重新取用。

GitNexus 索引为 `/volumes/kailo` 的 `c4d9e41`：`actor_keys` 报 `CRITICAL`，
直接调用者是消息发布/查询、媒体上传/读取和订阅；`project_buzz_roster` 报
`UNKNOWN`，源码 `service_api.rs` 的路由引用补齐了图谱未解析的调用边。
变更只收紧这些入口的签名条件，不改变原生端路径。没有修改 `.references` 或旧
K8S。

真实本地拓扑的 `server_keys` 集成用例先将 ACTIVE HUMAN 的 SecretRef 暂时错指
向同 Tenant CONTROL 的可读版本：BFF 发布得到 503；将同一 binding 调至
`RECONCILING` 后，身份投影得到 503 且状态不变；恢复原 SecretRef 与状态后，
Web 以 HUMAN 身份成功发布，后续原有 revoke→reprovision 链继续通过。该破坏
对象是实际数据库 binding，不是 mock 的密钥解析；用例收尾清除临时 Workspace。

构建前检查没有并行 Cargo/Go/前端构建；可用内存约 23 GiB。SQLx 查询快照在
`MemoryMax=20G`、`CPUQuota=800%` 的 cgroup 中重生，`cargo sqlx prepare
--workspace` 退出 0；以本地 Core 数据库执行 `cargo sqlx prepare --check
--workspace` 再次退出 0；`server_keys` 编译与 1/1 真实集成通过。Core 本地镜像在
受限 BuildKit 下构建并以一次性凭据恢复服务，运行镜像 manifest 为
`sha256:0193a220e71d9f4b11c292d322b48237a0bf97bd3656f4d86615ca98e8e3e6d1`。
`core/verify/run-integration.sh` 在 `MemoryMax=16G`、`CPUQuota=800%` 的
cgroup 中退出 0；其中 Relay 故障演练和 Approval continue-as-new 仍由该套件
标为 ignored，不能计入通过。随后 `./tools/check.sh --full` 在
`MemoryMax=16G`、`CPUQuota=600%` 的 cgroup 中十组通过；因未提供隔离
`DATABASE_URL`，本次实际迁移前进/回退演练为 SKIP，先前独立隔离库实演见
`task-terminal-repair.md`。

这项验证只闭合已启用 Buzz SERVER 身份的「指定版本可读且公钥匹配」条件，不是
完整 SecretRef 生命周期：服务凭据的轮换顺序、旧版本销毁条件与其他组件消费端
投递仍按 `apps/02` §4 单独验收。

## operator 首次引导的并发登记回读（2026-09-26）

依据 `SS-BUZ-OPERATOR`、`DD-70/72` 与 `.design/03` §2：部署投递的 operator
公钥必须与 Core 实际登记并可取用的身份一致。`platform_bootstrap::ensure` 原先在
首次建立身份时写 KV、执行 `ON CONFLICT DO NOTHING` 后直接返回成功；另一 Core
实例若在前置查询与插入之间先登记了不同公钥，后启动者会把未生效的投递误报为
引导成功。现在插入后回读唯一的 `ACTIVE` 行，核对其公钥与本次投递一致，并从
该行的定版 SecretRef 再次核对私钥派生公钥；任一条件不成立即拒绝进入 serving。
不改变 Tenant、Workflow、客户端合同或 Relay 投影；同一公钥的并发登记只接受
库中实际生效且可读的版本。

GitNexus `kailo-plus` 索引固定 `ebb9da387d68031d687c006dc512a8f3ff278e41`，
对 `platform_bootstrap::ensure` 的 upstream impact 为 `LOW`、直接调用者 Core
`main` 一处；因该函数是启动认证前置，按安全关键路径评审，没有以图谱 LOW
代替源码与运行核对。构建前确认没有并行编译，根盘可用 57 GiB、内存可用约
26 GiB；BuildKit `kailo-core-limited-20260925` 实际限额为 24 GiB/10 CPU，
外层 `MemoryMax=2G`、`CPUQuota=200%`。新本地 Core 镜像 manifest 为
`sha256:e4133277104ba015f897e059ed3c7a45f77f5fcd877379c15bda11354f99d159`；
`start-core.sh` 重新投递一次性凭据并重建 `core-bff` 后 `/healthz` 返回 200。
既有 operator probe 返回 `ACCEPTED`，pubkey
`152b7584d2067169e32262a206318a9ea97e8727c65f7a0c4b17dd51acfca416`
与 Core 库中唯一 `ACTIVE` 的 `RelayOperatorIdentity` 公钥相同、定版为 2。

`cargo sqlx prepare --check --workspace` 对本地 Core 数据库退出 0；
`./tools/check.sh --full` 在 16 GiB/500% cgroup 内十组通过，实际迁移前进/回退
因未传隔离 `DATABASE_URL` 为 SKIP。此次运行核对覆盖现存身份的正常冷启动，
没有制造双 Core 抢注的端到端竞态；因此不把并发分支标作已动态演练。KV 写入成功
但数据库登记失败仍会留下未被绑定的版本，本改动只消除“冲突后误报启动成功”，
不冒充完整 SecretRef 生命周期。

## operator 启动时的 Relay 准入与部署配置查证（2026-09-26）

依据 `SS-BUZ-OPERATOR`、`DD-70/72` 与 `.design/03` §2：Catalog Tenant 的
`RelayOperatorIdentity` 必须对应当前部署的 audience/origin，且 Relay 此刻接受
该公钥。此前同公钥冷启动只查定版私钥，未对 Relay 的 allow-list 做只读探针；
首次登记在探针前就会写 OpenBao。`platform_bootstrap::ensure` 现在对已有身份先
比较库中 audience/origin 与部署投递，对同公钥验证定版私钥后调用上游 operator
只读 availability 探针；轮换沿用原有写前探针；首次登记也在写 KV 之前调用探针。
并发登记后的 ACTIVE 回读额外比较 audience/origin。探针拒绝或传输结果不明时
Core 不进入 serving，不把它当成「已接受」；首次登记的该失败路径不写新 KV 版本。
Relay 后续变更 allow-list 仍由实际 operator 请求拒绝，启动探针不代替调用时校验。

GitNexus 仓库为 `kailo-plus`、工作树 `/volumes/kailo`、索引
`77f1f61e657896ba68b4486402b4237253890db4`；`ensure` 的 upstream impact 为
`LOW`，直接调用者仅 Core `main`，但它位于服务启动的认证前置链，按安全关键路径
复核。实现不改 schema、API、Workflow、三端或上游补丁；旧数据库行不迁移，
配置不匹配的旧行会明确阻止 Core 启动，由部署核对原始身份事实。

资源检查时无并行编译、可用内存约 26 GiB、系统盘可用约 49 GiB；Core 镜像在
24 GiB/10 CPU 的 `kailo-core-limited-20260925` BuildKit 中构建，外层为
`MemoryMax=2G`、`CPUQuota=200%`。新镜像 manifest 是
`sha256:937c7ed2f5ec478ca4d8a7475a1751339b25f1e91bd55399b5a4317e8fbe9695`；
一次性凭据重新投递后 `core-bff` 运行，`/healthz` 为 HTTP 200。当前 operator
公钥的只读探针返回 `ACCEPTED`，以本地非 operator 的 Relay key 调同一探针返回
`REJECTED 403`。此处故意更换探针的签名对象，确认拒绝面真实生效，未改动 Relay
allow-list 或旧 K8S。新镜像上的真实 `scope_lifecycle::
tenant_and_workspace_lifecycle_converge` 通过 1/1，Tenant 建立得到 Community，
Workspace 建立得到 Channel；该用例按既有 teardown 清理夹具。

`./tools/check.sh --full` 在 16 GiB/600% cgroup 中十组通过；没有隔离
`DATABASE_URL`，当次实际迁移前进/回退为 SKIP。在线 `cargo sqlx prepare --workspace`
清理一份不再使用的旧查询快照，随后 `cargo sqlx prepare --check --workspace` 退出 0。
这次没有直接演练「当前 ACTIVE key 被撤出 allow-list 后重启 Core」或双 Core 抢注；
已证明的是同一探针的接受/拒绝、现有身份正常冷启动与真实建 Tenant 链，不将其
扩大表述为所有并发或 Relay 重配置场景均通过。完整 SecretRef 轮换与旧版本销毁
仍是独立 Stage 2 门禁。

## 已启用 Buzz 身份的 KV 版本上限隔离（2026-09-26）

依据 `DD-70/72`、`.design/03` §9：旧 SecretRef 在固定旧 generation 的执行终态
前必须保持可读。OpenBao 固定基线
`735723da5628148f232497a48a35a137b6512103` 的
`openbao/internal/builtin/logical/kv/path_data.go::KeyMetadata.AddVersion` 在同一
KV 路径新增版本达到 `max_versions` 时删除最旧版本；两级配置都为零时使用
`backend.go::defaultMaxVersions = 10`。本地 mount 明确设置了 1000，但这仍是
有限上界。此前 Web 托管 HUMAN 重建反复写
`buzz-human/<tenant>/<principal>`，operator 轮换反复写同一 audience 路径；
上游自动淘汰不检查 Core 的旧 generation 是否终态。当前数据库中 HUMAN
托管引用只有 1 条、最高 KV 版本为 1，不存在本地已越过上限的旧引用。

现在每次 HUMAN 新公钥占一个独立 KV 路径；operator 每次投递也占一个独立
路径，即使日后切回相同公钥也不重用它。两者仍保存 OpenBao 返回的具体版本，
读端只按绑定行中的 locator/version/audience 取值。旧行无迁移、API/Workflow/
四端契约无变化；已发布旧 Core 读取新行时同样只读登记的 locator，不依赖路径
形状。失败面仍是 fail closed：新路径写入成功但数据库冲突时会留下孤儿 KV
路径；它不能被误认为 ACTIVE，也不能在没有权威引用核查时删除。

GitNexus 绑定 `kailo-plus`（`/volumes/kailo`），索引
`118272845340b48220eae8b535d0ad7ba5a9720f`：
`ensure_human_identity` 有两条直接调用链（成员 roster 投影、Web 托管 key 重建），
`platform_bootstrap::ensure` 的直接调用者为 Core `main`，`rotate` 由 `ensure`
调用；图谱均报 LOW。它们是密钥与启动安全关键路径，因此还以源码引用检索和
真实集成核对，不把图谱风险等级当作验收结论。

构建前检查无并行编译，内存可用约 22 GiB、系统盘可用 42 GiB；Core 镜像在
受限 `kailo-core-limited-20260925` BuildKit 中构建，外层
`MemoryMax=2G`、`CPUQuota=200%`，manifest 为
`sha256:9cf9c4d158c4db9d1a49df70affd03032f2802ffcf4cca8995ee98b44f73e678`。
`start-core.sh` 重新投递一次性引导凭据后容器使用该镜像，BFF `/healthz`
返回 HTTP 200。受限 cgroup 中 `cargo test -p kailo-core --test server_keys`
在真实 OpenBao/Relay/Temporal/Core 拓扑通过 1/1：旧身份撤销、新独立 locator
与新 pubkey、旧钥匙直连被拒、新身份发言恢复全部成立。把「新旧 locator
必须不同」断言故意反转为相同后，同一用例退出 101 且输出实际不同的两条路径；
还原后再跑通过 1/1。`./tools/check.sh --full` 在 16 GiB/600% cgroup 中十组
通过；当次未传隔离 `DATABASE_URL`，实际迁移前进/回退演练为 SKIP（本改动无
schema 迁移）。

本刀只防止已启用 HUMAN/operator 的新写入在同一路径触发自动淘汰；没有执行
operator 再轮换的真实动态演练，也没有实现旧版本销毁、孤儿路径收敛、服务
凭据轮换顺序或未来组件消费端投递。故不把 Stage 2 SecretRef 生命周期标记完成。

## operator 独立 KV locator 的动态轮换（2026-09-26）

权威为 `DD-70`、`SS-BUZ-OPERATOR`、`.design/03` §9 与 `.design/09` 的
`RelayOperatorIdentity rotate`。在起点提交
`51948ecb053b6bb74bb40a58d02af07a94c9b199` 的本地 Compose 拓扑中，
`drill-operator-rotation.sh` 将旧 `152b75… v2 kv2` 切换为新
`d68c53… v3 kv1`，两个 SecretRef locator 不同。Relay 仍加载旧 allow-list
时故意启动 Core：operator 只读探针得到 403，Core 退出，数据库仍是旧行。
新旧公钥并列进入 Relay 后，Core 经 `start-core.sh` 现取一次性引导凭据启动，
日志记录 `RelayOperatorIdentity 已轮换`；数据库新行 `ACTIVE`，审计
`relay_operator.rotate=ROTATED`（2026-09-26 20:31:12 UTC）。

窗口内对两把私钥运行 `operator_probe`，均返回 `ACCEPTED`；新 key 上的
`cargo test -q -p kailo-core --test scope_lifecycle tenant_and_workspace`
通过 1/1。随后将旧公钥先移为 `.closing` 而不销毁，重新派生配置并仅重建
本地 Relay；`/_readiness` 与 BFF `/healthz` 均为 HTTP 200，派生 allow-list
不含旧 pubkey，实际探针分别为 `ACCEPTED d68c53…` 与
`REJECTED 403 152b75…`。确定两项结果后删除本地退役公钥与私钥文件，
没有触碰旧 OpenBao KV 路径；旧 KV 仍须按 `.design/03` §9 的终态证据处理。

演练脚本首次运行在轮换已成功后退出 1：它只扫描 Core 日志最后五行的
`listening`，而启动后的其他日志将该行挤出窗口；当时 Core `/healthz` 已为
200。脚本改为等待 BFF 健康端点，并把关闭窗口后的旧 key 断言修正为
实际输出 `REJECTED 403 <pubkey>`，不再把脚本误报记成 Core 失败。
这次真实链只闭合 operator 的新 locator、Relay 重叠与撤旧验收；
旧版本销毁、孤儿 KV 路径收敛、其他组件消费端投递与服务凭据轮换顺序仍未闭合。
