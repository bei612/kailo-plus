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

## Tenant CONTROL 新密钥的 KV 路径隔离（2026-09-26）

权威为 `DD-70/72` 与 `.design/03` §9。OpenBao 固定基线的
`KeyMetadata.AddVersion` 对同一路径执行 `max_versions` 淘汰；此前
`tenant_lifecycle::provision_tenant_buzz` 每次生成新 CONTROL 公私钥，却总写入
`buzz-control/<tenant>`。Tenant 投影重试会在同一路径累加版本，与旧 generation
仍需保持可读的合同冲突。现将新写入路径固定为
`buzz-control/<tenant>/<新公钥>`，保留 OpenBao 返回的 version 与原 audience；
读取仍使用 binding 中的 locator/version/audience。已有 CONTROL 行不迁移，
没有 schema、API、Workflow、三端或上游补丁变化。此变更只阻止新的 CONTROL
写入因共用路径触发自动淘汰，不解决写 KV 后落库失败留下的孤儿路径。

GitNexus 对 `provision_tenant_buzz` 的调用影响报告为 `UNKNOWN`、零可解析调用者；
源码检索确认 `service_api.rs` 将其注册为 Tenant 建立的服务路由，真实
`scope_lifecycle` 用例调用该路由。图谱零调用者不被当作无影响的证据。构建前
无并发编译、可用内存约 26 GiB，系统盘可用 42 GiB；Core 在 24 GiB/10 CPU
的 `kailo-core-limited-20260925` BuildKit 内编译，外层受
`MemoryMax=16G`、`CPUQuota=600%` 约束。新镜像 manifest 为
`sha256:b3c3cc438165c70ce3251a589fcc96a47bfc16e2541551a4b3d1d8fd6f649083`；
`start-core.sh` 重新投递一次性引导凭据后，本地 `kailo-local` 的 BFF
`/healthz` 返回成功。

检查在实现后增加。部署旧 Core 时，受限 cgroup 内运行
`cargo test -q -p kailo-core --test scope_lifecycle tenant_and_workspace_lifecycle_converge`
退出 101，断言明确报出 `CONTROL 每把公钥必须独占 KV 路径`，夹具清理完成；
切换新 Core 后同一真实用例 1/1 通过。随后
`core/verify/run-integration.sh` 在 16 GiB/600% cgroup 下退出 0：
Core/Worker 全套集成通过，包含 `scope_lifecycle` 2/2、Web 传输 8/8、
ServerKey、角色、邀请、Governed Action 与 Workflow 对账；两项需停启共享服务
的专门演练按测试声明保持 ignored。此次没有验证 CONTROL key 的轮换或销毁：
它们仍受 `GAP-BUZ-01` 阻断。孤儿 KV 路径、旧版本终态处置与其他消费端投递
仍是 Stage 2 SecretRef 生命周期缺口。

## Tenant namespace 归属缺口的原始核验（2026-09-26 21:19 UTC）

`DD-70/72` 与 `.design/03` §9 把平台凭据放在 `platform/`、Tenant 的
HUMAN/CONTROL 私钥放在各自 `tenants/<tenant_id>` OpenBao namespace。
当前 `openbao-init.sh` 只建立 `OPENBAO_PLATFORM_NAMESPACE` 的 KV mount 与
`kailo-core` AppRole；`main.rs` 把该 namespace/mount 作为
`ServiceState.secret_mount`，`membership_projection::ensure_human_identity` 和
`tenant_lifecycle::provision_tenant_buzz` 由此形成 `platform/kv/buzz-*` locator。
固定部署的 root namespace 执行只读 `bao namespace list -format=json` 实得
`["platform/"]`；Core 源码与本地引导脚本没有创建 `tenants/<tenant_id>` 的路径。
所以“路径中含 Tenant ID”不等于设计规定的 Tenant namespace 与独立 mount/policy/token。

这是 Stage 1 的 OpenBao 最小面退出缺口，不因当前签名、roster 或集成用例通过而
自动闭合。现有 ACTIVE 绑定仍按其已存 locator/version/audience 读取；直接把
新写入改指向尚不存在的 Tenant namespace 会使新 Tenant 建立失败。
后续必须同时解决 Tenant namespace/mount/policy/token 的创建与重启后的取用、
旧 `platform/kv` 引用的兼容迁移、以及失败时的对账，才能改变写入位置。

## Tenant namespace 新写入与 ACL 联调（2026-09-26 22:24 UTC）

此节更新上一节的**当前状态**，不改写当时的缺口证据。`DD-70/72`、
`.design/03` §9 是权威：部署建立 `platform/` 与 `tenants/` 父 namespace；
Core 以一次性 wrapped AppRole 凭据取得父级 provisioner token。Tenant 生命周期
用固定 Tenant UUID 在父级创建子 namespace，随后在子级配置并回读 KV v2 mount、
`cas_required`、`max_versions`、AppRole、最小 policy 与 role。父级 token 只有
配置权，不读子级 KV；Core 再用子级单次 secret-id 换取该 Tenant 的 token。
HUMAN/CONTROL 新写入只生成 `tenants/<tenant_id>/kv/buzz-*` locator；已存的
`platform/kv` SecretRef 继续按原 locator/version/audience 读取，不把它静默
改指向新路径。

GitNexus 对 `split_locator` 给出 CRITICAL、14 个受影响符号、13 条过程，涉及
Web 代签、成员与 Tenant 生命周期；旧 locator 兼容因此保留。OpenBao@
`735723da5628148f232497a48a35a137b6512103` 的
`openbao/internal/vault/logical_system.go::handleReadMount` 与
`::handleReadAuth` 在资源不存在时返回 `logical.ErrorResponse`，实测 HTTP 400，
而不是通用 404。Core 只把这两种完整错误文本认作可创建事实；其余 400、
401/403 与不可解析回应均拒绝，不把权限失败变成“缺失则创建”。

受限 BuildKit（24 GiB/10 CPU）构建的新 Core manifest 为
`sha256:d7457cde64c5535adc1050f76567a95da9d349327134d8550ee363f044c87954`；
部署重投三个一次性引导凭据后，BFF `/healthz` 为 200。真实
`scope_lifecycle::tenant_and_workspace_lifecycle_converge` 1/1 通过；
`core/verify/run-integration.sh` 在 16 GiB/500% cgroup 中最终退出 0，包含
SecretRef 真实 OpenBao 用例、Core/Worker、Tenant/Workspace 生命周期、
Web transport 8/8 与 ServerKey revoke/reprovision。首次全套运行在
`server_keys` 失败：夹具用 `splitn(3)` 错解两级 namespace，且持有无权读取
Tenant KV 的 `platform/` 核验令牌；改为按 Tenant UUID 解析、按需签短期子级
`kailo-core` policy 令牌、读取后确认撤销，定向 1/1 与全套复跑均通过。

独立 ACL 探针使用两个**真实存在**的测试子 namespace 与 KV 路径：Tenant A
token 读 A 为 HTTP 200、读 B 为 403；`tenants/` 父级 provisioner token
读 A 为 403；两枚探针令牌的 `revoke-self` 均为 204。只读 KV metadata
显示所查旧版本未销毁，证明首次 `server_keys` 失败不是旧版本丢失。

上述结果证明新建 Tenant 的最小隔离链，不等于 Stage 1/2 退出。旧
`platform/kv` 活跃引用仍需受治理地迁移并处置旧版本；生产规模下 namespace
数量、会话缓存与续期负载尚未验证。完整 SecretRef 轮换、
旧版本销毁与其他消费端投递仍属 Stage 2 缺口。

### 本地集成夹具的 namespace 清理与恢复（2026-09-26 22:39 UTC）

清理前只读核对：OpenBao 的 `tenants/` 下有 29 个子 namespace，Core
`identity.tenant` 有 2 行，两组 UUID 的交集为空。为避免删除仍被 Core
会话缓存持有的 namespace，先停止本地 Compose 的 `core-bff`；逐个按已
核对的 29 个 UUID 调用 `bao namespace delete`，随后 `namespace list` 返回
`No namespaces found`，证明异步删除已从目录收敛。所删 namespace 中的
本地测试密钥不可恢复；未触碰数据库中两个有效 Tenant，也未操作旧 K8S。
Core 用 24 GiB/10 CPU 的受限 BuildKit 重建，镜像 manifest 为
`sha256:2e3811d57ffe807174f9c908e7493de21e9aaacaa8528174c4e9ccf0603b527c`；
`start-core.sh` 重投三个一次性引导凭据后，容器 `running`，BFF
`/healthz` 为 HTTP 200。此前本批改动的 `check-docs.sh` 七组、
`check.sh --full` 十组均退出 0；全量门禁因未给隔离 `DATABASE_URL`
明确跳过实际迁移前进/回退，本批没有 schema 变更。本次手工清理不替代
集成夹具今后的自动收敛，也不证明生产 Tenant 销毁能力；后者仍受
`GAP-LCM-01` 阻断。

### 测试 namespace 在线删除的失败证据（2026-09-27）

曾尝试在集成测试删除 `identity.tenant` 行后，立即删除对应的 OpenBao 子
namespace。这个顺序不成立：Core 仍缓存该 Tenant 的 AppRole service token，
`SecretStore::tenant_session` 为它启动的续期任务仍在运行。子 namespace 删除后，
续期返回 HTTP 404，`SecretStore::keep_alive` 把失败送到 Core 的全局失效分支，
Core 按现有 fail-closed 合同退出；随后 `run-integration.sh` 的 Web transport
八项都因本地 BFF 连接被拒而失败，不能报作通过。Core 退出时对已消失
namespace 的 `revoke-self` 也得到 404，日志明确记为撤销未确认。

故障核对：失败前治理、成员、角色、Tenant/Workspace、密钥与邀请的真实用例
依次通过；2026-09-27 00:00:17 UTC 的 Core 日志记录多枚 Tenant token 撤销
未确认，容器随后退出。曾为验证清理断言故意把父 namespace 改成 `invalid`
的单项核验，在 2026-09-26 23:43:12 UTC 创建测试子 namespace 后于清理断言
处失败；OpenBao audit 无对应删除请求。该 UUID 在 Core Tenant 表中不存在，
精确 lookup 为 `tenants/<该 UUID>/`，故仅删除此测试残留；lookup 随后返回
`Namespace not found`。在线删除的测试夹具改动未提交，已按原文件恢复。

恢复核验：用 `deploy/local/start-core.sh` 重新投递三份一次性引导凭据并在
受限构建器中重建本地 Core；BFF `/healthz` 为 HTTP 200。OpenBao 的
`tenants/` 子目录列表为空，Core `identity.tenant` 仍有两个有效 Tenant。
这不构成完整集成通过的证据：上述八项失败发生在恢复之前，本次尚未重新
运行完整集成。夹具 namespace 的清理只能在 Core 不再持有该子级 service
token 时执行；不得以放宽 Core 的 token 失效全局退出规则来掩盖在线删除。

### 恢复原始夹具后的完整复验与离线清理（2026-09-27 00:23 UTC）

运行前 `git status` 干净、BFF `/healthz` 为 HTTP 200，OpenBao `tenants/`
列表为空，Core 数据库有两个有效 Tenant；未运行其他 Cargo/Rust 构建。
在 `MemoryMax=16G`、`CPUQuota=500%` 的 cgroup 内运行未修改的
`core/verify/run-integration.sh`，退出码 **0**。SecretRef 的 OpenBao 用例、
Buzz bridge/operator、治理、成员、角色、Tenant/Workspace、托管密钥、邀请、
Workflow 终态对账及 Go Worker 套件通过；上次失败的 `web_transport` 八项
全部通过。显式标记为 ignored 的 Relay 故障与 Approval continue-as-new
演练不计入此次通过范围。上次失败确由在线删除测试 namespace 导致，
不是原始夹具下持续存在的 Web transport 回归。

本次运行后 OpenBao `tenants/` 列出 17 个新子 namespace；运行前为空，
且其 UUID 与数据库中两个有效 Tenant UUID 均不相交。先停止**本地 Compose**
的 `core-bff`，再一次性核对 Core 已退出、待删集合仍精确等于这 17 个 UUID、
且与有效 Tenant 不相交。仅对这 17 个明确 UUID 调用 `bao namespace delete`；
各项返回 `Namespace deletion scheduled`，随后 `namespace list -format=json`
返回 `{}`（CLI 对空列表退出码 2）。测试夹具中的密钥已不可恢复；没有删除
两个有效 Tenant 的数据库记录，没有操作旧 K8S。第一次删除命令因 shell
引号错误退出 2，发生在调用 `bao namespace delete` 之前；修正引号并以只读
`namespace lookup` 核对目标后才执行删除。

重新检查内存、CPU、磁盘与受限 BuildKit 后，以 `start-core.sh` 重投三份
一次性引导凭据并恢复 Core；构建与启动在 16 GiB/500% cgroup 内，
BuildKit 自身限额为 24 GiB/10 CPU。最终 `core-bff` 为 Up、BFF
`/healthz` 为 HTTP 200、`tenants/` 仍为空。此项闭合的是本次真实集成
复验与安全的**离线人工夹具清理**；`run-integration.sh` 本身仍不自动收敛
测试 namespace。旧 `platform/kv` 活跃引用迁移、完整 SecretRef 生命周期、
生产规模会话与续期负载以及 Stage 1/2 退出门禁仍未闭合。

### 旧身份 SecretRef 迁移前的只读盘点（2026-09-27 00:39 UTC）

在提交 `d84300cad2df48d4d59abea28825fbe14b9c3ac4` 的本地拓扑上，
只读查询 `identity.buzz_identity_binding` 中 `state='ACTIVE'` 且 locator
以 `platform/kv/` 开头的行，得到 `CONTROL|ACTIVE|1` 与
`HUMAN|ACTIVE|1`，两行属于同一个业务 Tenant。另有部署级
`RelayOperatorIdentity` 使用 `platform/kv`，按 `DD-70` 应保持平台归属，
不在这次业务 Tenant 迁移范围内。查询只输出种类、状态和计数，未取私钥。

同一 Tenant 的本地 `admission.action_execution` 与
`projection.workflow_ref` 联查得到四条
`ALLOWED|NOT_DISPATCHED|TERMINAL`；这只说明当前数据库中这些引用的
Workflow 投影已终结，不证明所有旧 generation 消费者都已终结，更不能作为
销毁旧 KV 版本的充分证据。当前 `catalog.action_definition` 有 21 条
`ACTIVE`，其中 action key 匹配 `%secret%` 或 `identity.key_%` 的为零。
本地数据库没有名称含 `secret` 的业务表；迁移脚本中也没有持久
`SecretRef` 版本状态表。`identity.buzz_identity_binding` 仅保存现用的
locator/version/audience 三元组与 binding version。

这使“直接更新两条 locator”不符合 `.design/03` §9：旧 SecretRef 将失去
`SUPERSEDED` 保留与旧 generation 终态对账的持久依据，也没有本次受治理
写入的准入与审计。现有 `server_keys` 的 HUMAN revoke/provision 会更换
pubkey，不能代替同一私钥的跨 namespace 迁移；CONTROL 的密钥轮换又受
`GAP-BUZ-01` 阻断。`SecretStore::read` 与 `write` 已支持按定版版本读取和
对 Tenant namespace 做 CAS 写入，`server_identity::read_bound_keys`
可核对复制后的私钥确实派生出原 pubkey，但它们不是完整迁移事务。

下一刀需把**同一 pubkey 的 SecretRef 重新归位**与**更换私钥/pubkey**
明确分开：以前者为受治理动作持久记录新旧 locator/version、写前意图、
读回与 pubkey 校验、binding CAS 切换、审计以及旧 generation 的终态留存；
结果不明时按同一动作对账，不盲目再写新 KV 版本。未形成这条闭环前，
保留兼容读取，既不改两条活跃数据库引用，也不 `destroy` 旧 KV 版本。

复核入口：`core/migrations/20260922181510_identity_stage1.up.sql`、
`20260922234500_secret_ref_columns.up.sql`、`kailo-secrets/src/lib.rs`
的 `SecretStore::tenant_locator/read/write`、`kailo-core/src/server_keys.rs`
的 HUMAN revoke/provision，以及 `.design/02` 的 `DD-70/72`、`.design/03` §9。
GitNexus 对 `SecretStore` impl 的 upstream impact 返回 `risk: UNKNOWN`
且未解析调用者；文本检索在 Tenant lifecycle、membership projection、
Web transport、identity projection 和 operator bootstrap 均找到取用点，
故不能把图谱的零调用者解释为低风险。

### 确定性 operator locator 的响应丢失收敛（2026-09-27）

本次只处理已按 pubkey 固定 locator 的部署级 Relay operator 写入，
不开放 `SECRET_REF_REHOME` 动作，也不变更业务 Tenant 的旧引用。
`SecretStore::write_once` 对不存在路径执行 KV v2 `cas=0` 首次写入，
对已存在路径只读取钉定版本并核对原值；值不同即拒绝。
`platform_bootstrap::ensure/rotate` 改用该调用，避免首次写入已生效但
HTTP 回应丢失后，重启或重试把同一意图追加为下一 KV 版本。
原 `write` 的追加新版本语义及 Tenant/成员投影调用保持不变。

GitNexus 对 `platform_bootstrap::ensure/rotate` 的 upstream impact 为
`LOW`，调用链通向 Core `main`；对 `SecretStore` impl 返回 `UNKNOWN`，
已用源码检索确认其他调用方。此次没有 schema、API、Workflow 或三端改动；
任何 transport 失败仍向调用方返回错误，不能把它当成写入成功。

`cargo test -p kailo-secrets` 的五项单测均通过；真实 OpenBao 集成用例
在未设置 `KAILO_INTEGRATION=1` 时按自身门禁跳过，不能计入真实服务验收。
新增单测模拟 OpenBao 写入后断开连接：第一次得到 transport 错误，
同一 locator 重试读回版本 1，不发第二次 POST；不同值重用该路径被拒。
故意把“仅当当前版本为 0 才写”改成“版本小于等于 1 也写”，
该用例退出码 101；还原后全量门禁通过。`./tools/check.sh --full`
在 16 GiB/500% cgroup 内退出 0，十组通过；其中没有隔离
`DATABASE_URL`，实际数据库迁移前进/回退为 SKIP。

这只验证确定性写入的本地行为，不证明新 Core 镜像已部署，
也不证明 `DD-85` 的受治理归位、旧 generation 终态或旧版本销毁已闭合。

### 真实 OpenBao 对确定性重试的查证（2026-09-27）

在本地 `kailo-local` OpenBao 上，先于一次性凭据投递完成
`cargo test -p kailo-secrets --no-run`，再由现有
`integration-env.sh` 与 `seed-secret-ref.sh` 提供核验身份及 KV v2
夹具；`KAILO_INTEGRATION=1 cargo test -p kailo-secrets --test openbao`
退出 0，真实用例 1/1 通过。该用例在原有 CAS 写入 `v3` 后，
用 `write_once` 对同一路径同值重试，返回的版本仍为 `v3` 的版本号；
不同值被 `WriteRejected` 拒绝。没有创建新的 Tenant namespace，
也没有取用业务身份私钥。

此证据覆盖真实 OpenBao 的已存在路径与版本不追加行为；
HTTP 写入响应丢失的分支仍由前述可破坏的本地协议夹具验证。
随后仅重建本地 Compose 的 `core-bff`：受限 BuildKit 容器上限为
24 GiB 内存与 10 核，外层命令运行在 2 GiB/200% cgroup；镜像
`sha256:547cdb4ccd9329675e8fa54b32ea866bb20c99f9efccc661e04a017fcdf67c93`
构建并重建容器后，`/healthz` 返回 HTTP 200。启动日志同时报告
4 条待对账 Action 的派发失败（`no rows returned by a query that expected to
return at least one row`）与 1 个 Tenant 缺有效 admin。只读 SQL 对账表明
前四条均为测试夹具写入的 `verify.provision`，且没有匹配版本的
`catalog.action_definition`；不据此删除任何业务数据。健康检查不证明
这些存量状态已收敛。此次没有运行 `SECRET_REF_REHOME`，业务 Tenant
归位与旧版本销毁仍未启用，也不把本地镜像当作发布产物。

### 全套集成夹具的离线 namespace 收敛（2026-09-27）

`run-integration.sh` 本轮把测试 Tenant UUID 登记在独立清单；进入 EXIT
trap 时先拒绝运行前已存在的 UUID，核对 Core 的 Tenant、Principal、Buzz
binding 与 SecretRef rehome 引用，再精确核对 OpenBao 子 namespace 路径。
仅在停止本地 Compose Core
之后删除清单内仍存在的测试 namespace，随后重投一次性凭据并恢复 Core；
运行前后的完整子 namespace 集合必须相等，否则整轮失败并保留清单。
部署引导重试对同一 Tenant 的重复登记是幂等的。

首次复验通过了 Rust/Go 全量用例，但发现四个本轮新建的子 namespace
未走原有夹具登记。只读核对其 Core 四类引用均为零、OpenBao 路径均精确
匹配后，停止本地 Compose Core，仅离线删除这四个 UUID，并在受限
BuildKit 与 cgroup 中恢复 Core。随后将部署引导及直接建 Tenant 的共用
夹具纳入登记，再运行完整 `run-integration.sh`：退出码 0，本轮 19 个
测试 namespace 离线收敛；运行前后集合均为原有 16 个，BFF `/healthz`
独立复核为 HTTP 200。故意在集合检查的输入中额外注入一个名称时，
检查退出 1 并报告差异；还原输入后退出 0。`check.sh --full` 十组退出
0，其中未提供隔离 `DATABASE_URL`，实际数据库迁移演练为 SKIP。
审查时另发现停止 Core 的命令失败后容器已停的路径未触发恢复；将恢复标记
提前到停止命令前，并用隔离的命令桩让停止返回错误，确认整轮退出 1 且
调用恢复分支，不触碰真实容器。把登记 UUID 故意放进运行前集合时，
清理在数据库查证、OpenBao lookup 与停机之前退出 1。

原有 16 个子 namespace 不属于本轮登记清单，未删除，也不据此声称
生产 Tenant 销毁已闭合；本轮删除的四个测试 namespace 中的密钥不可恢复。

### Stage 2 SecretRef 生命周期缺口逐项对照（2026-09-29）

对照本文件 L267–269 与 L296、L329 列出的四项缺口，按设计是否已定义逐项核对：

| 缺口 | 设计依据 | 现状 |
| --- | --- | --- |
| 孤儿 KV 路径收敛：SERVER HUMAN 写入后未绑定 | `DD-86`、`V-SCN-70` | 已实现，本日修正两处使其无法终结的缺陷，见 `native-identity.md`「V-SCN-70 孤儿版本终结的复核」 |
| 孤儿 KV 路径收敛：归位副本切换被拒 | `DD-85`、`V-SCN-69` | 已实现（`secret-ref-rehome.md`「复制后被拒与开放」），与上一行共用 `destroy_unreferenced_version_one` |
| 旧版本销毁：遗留 `platform/` 身份归位后 | `DD-85`、`03` SecretRef 状态机 | 已实现（`RETIRED`），本日补回应丢失注入用例 |
| 旧版本销毁：HUMAN key revoke/重建后旧 pubkey 的 KV 版本 | `DD-72` 只写「旧版本 destroy」；`09` key revoke/rotate 行只写旧 binding 保留 `REVOKED` 供审计；`DD-70` 的 `SUPERSEDED→REVOKED` 以「固定旧 generation 的在途执行」为前提 | 设计未定义：何时触发、哪些执行算固定旧 HUMAN generation、SecretRef 状态落在何处（现无持久 SecretRef 状态表）、是否为独立 Governed Action，且 `DD-70` 又规定紧急撤销用 `delete` 不用 `destroy`。未实现 |
| 旧版本销毁：RelayOperatorIdentity 轮换后的旧 KV | `09` RelayOperatorIdentity rotate 行没有销毁步骤 | 设计未定义，未实现 |
| 孤儿 KV 路径：Tenant CONTROL 写入后落库失败、operator 写入后登记失败 | `DD-86` 只覆盖 SERVER HUMAN；CONTROL 另受 `GAP-BUZ-01` | 设计未定义，未实现 |
| 服务凭据轮换顺序（`SERVICE_CREDENTIAL`/`DATA_KEY`） | `DD-70`、`DD-93` `secret_schema` | 设计已定义，依赖 ApplicationBinding 与 release `secret_schema`，Core 中尚无该实体，不在本次文件范围 |
| 各消费端投递（OpenBao Agent template、spawn env） | `DD-71` | 设计已定义，属部署与组件接入面，不在本次文件范围 |

据此 Stage 2「完整 SecretRef 生命周期」仍不能标记完成：前两类已实现项缺真实拓扑运行证据，
其余各项或设计未定义，或依赖尚不存在的实体。

### DD-113 平台自持 Nostr 私钥的退役与孤儿写入（2026-09-29）

上表中「设计未定义」的三项已由 `DD-113`、`SF-OBA-13` 与 `V-SCN-86` 定下，本节记录实现与
核验现状。

- 迁移 `20260930120000_platform_key_retirement`：写入意图加 `key_kind`、`operation_id`、
  `retired_at`，主键改为独立 `id`（OPERATOR 没有 ActionExecution），按类别的未完成唯一与
  形状、RETIRED 只由 BOUND 进入的约束；binding 加 `private_key_secret_status`（引用为空即
  为空，REVOKED 时只能是 SUPERSEDED/REVOKED）；存量 SERVER HUMAN/CONTROL binding 与
  operator identity 按当前 ref 补建 BOUND 意图（operation 由 locator 确定性派生，不指向
  真实 operation）。回滚移除补建行，存在 CONTROL/OPERATOR 或 RETIRED 意图时拒绝。
- 共用收敛 `platform_keys`：孤儿 fence→`cas=0`→销毁版本 1→metadata 查证与审计由 HUMAN
  专用改为三类共用；退役为 `retire_bound_version_one`（不抢占空路径）+ `mark_retired`。
  `secret_store::owns_platform_key` 把三类 key 限定在各自独占形状，未归位的 `platform/`
  存量不能借退役或孤儿收敛删除或销毁。
- HUMAN 撤钥：身份投影在 `REVOKING` 时先 `delete` 并以 `deletion_time` 查证、引用转
  SUPERSEDED，roster 移出与 `REVOKED` 之后 `destroy` 并查证，意图 RETIRED、引用 REVOKED，
  审计追加到撤钥 operation；重试按 `REVOKED` 的确定下一版本找回。
- operator：locator 改为由 pubkey 派生，登记/轮换前冻结意图，同一 key 重投递续用；旧 key
  在 Relay 以 401/403 拒绝后由下一次引导销毁并记 RETIRED，仍被接受或探针不明时保留告警。
- CONTROL：Tenant 建立先冻结意图再写，同一 operation 重试续用或 fence 后销毁；另一
  operation 遗留的由治理对账器在其 WorkflowRef 终态、动作不再 ALLOWED 或另一 CONTROL
  胜出时隔离销毁；OPERATOR 遗留的在超过准入对账上界后隔离销毁。
- 未完成退役由 `platform.server_key.retirement_pending` 度量与日志告警。

核验：`secret-store` 单元 14/14（新增独占形状、delete 回应丢失按 `deletion_time` 查证、
版本 2 不删、已绑定退役不抢占空路径）；`platform_keys` 审计分类 2/2；fmt、clippy
`-D warnings`、`cargo test --workspace --no-run` 通过。破坏核验：退役改为抢占空路径、
delete 忽略 `deletion_time`、形状放行 `platform/`、去掉 CONTROL 审计分类，各自使对应
检查失败，还原后通过。新增集成用例 `human_revoke_lost_responses_converge_by_metadata`、
`control_orphan_writes_are_reused_or_destroyed`、`operator_orphan_write_is_destroyed_by_reconciler`
与扩展后的 `server_key_is_revoked_then_reprovisioned` 尚未在集成拓扑运行，本节不构成
`V-SCN-86` 的终态证据。

补充（同日）：`tenant_lifecycle::verify_tenant_buzz` 把 CONTROL binding 转 `ACTIVE` 的同一句
UPDATE 同时把私钥引用由 PENDING 转 ACTIVE；`server_key_is_revoked_then_reprovisioned`
断言夹具 Tenant 的 ACTIVE CONTROL 与 HUMAN 引用均为 ACTIVE（未在集成拓扑运行）。
`platform_keys` 在 crate 根正常声明。存量补建行的 `operation_id` 取值待设计给出如实表示后
修改，本节不将其视为已定。

### DD-115 实施补充（2026-09-30）

- 迁移 `20260930120000_platform_key_retirement` 按 DD-115 重写：意图加 `origin`
  （PROVISIONED/BACKFILLED）、`commit_deadline_at`、`retire_operation_id`；`operation_id`
  与 `action_execution_id` 可空。约束：PROVISIONED 必有 operation；BACKFILLED 两者皆空、
  只以 BOUND/RETIRED 存在；PROVISIONED 的 OPERATOR 必有提交截止、其余类别没有；
  `retire_operation_id` 只挂在 BOUND 上，RETIRED 必有它。存量补建行如实为 BACKFILLED，
  不再派生 operation；已 REVOKED 的存量 binding 没有可追溯的撤销 operation，不冻结，
  由 `platform.server_key.retirement_pending` 告警。
- 退役审计：撤钥（身份投影 REVOKED）、成员撤权投影（REVOKED）与 operator 轮换在各自
  的同一事务冻结 `retire_operation_id`，退役审计追加到它；孤儿审计仍记意图自己的
  operation，且只处理 PROVISIONED。
- 成员撤权投影在 roster 查证后执行 delete 与 destroy 并按 metadata 查证；未完成的由
  治理对账器补做（binding REVOKED、意图 BOUND、退役 operation 已冻结）。
- OPERATOR：冻结时 `commit_deadline_at = now() + RELAY_OPERATOR_COMMIT_WINDOW_SECONDS`；
  登记与轮换的事务只在截止前、未 fence 时提交；对账器以截止为终态判据。引导遇到另一
  把 key 的过期意图时以同一 fence 实现销毁后继续，未过期则给出截止时刻并退出。
- 对账器只读 LIST operator 前缀，按 metadata 仅对恰为版本 1 的无引用、无意图 locator
  补建 BACKFILLED 并退役；版本大于 1 或不可判定的不落状态、告警。platform 策略原已对
  `metadata/*` 授予 `list`，无需改动。

单元：secret-store 15/15（新增 operator 前缀只读列出与层数上界）；把层数上界放宽后该
检查失败，还原后通过。fmt、clippy `-D warnings`、`--bins`、`--no-run` 通过。新增或
改动的集成用例（`membership_revocation_retires_server_keys`、
`unrecorded_operator_locators_are_backfilled_and_retired`、OPERATOR 截止判据，及
`membership_projection`、`web_transport` 中直接驱动 Tenant 撤权的用例补 WorkflowRef 夹具）
尚未在集成拓扑运行。

### 接手复验与当前生命周期边界（2026-09-30）

以 `0ec5e552` 之后接手的工作树运行既有 `core/verify/run-integration.sh`：
`secret-store` 单元 **15/15**、真实 OpenBao 的
`wrapped_delivery_and_secret_ref_boundaries` **1/1**、`tests/server_keys.rs` **7/7**、
`tests/secret_ref_rehome.rs` **6/6** 均通过。原始日志为
`/volumes/data/kailo/tmp/codex-integration-20260930.log`；身份与归位的逐项结果分别见
`native-identity.md`「接手复验」与 `secret-ref-rehome.md`「接手真实拓扑复验」。

因此，09-29 缺口表中平台自持 HUMAN、CONTROL、OPERATOR 的「设计未定义、未实现」
已被 `DD-113`、`DD-115` 及其实现替代，不再作为当前结论。旧 DD-113 实施段落所记
「由 locator 派生存量 operation」也已撤回：当前存量意图为 `BACKFILLED`，原 operation
为空，退役事实挂在真实的 `retire_operation_id` 上；提交时限只属于 `PROVISIONED` 的
OPERATOR。不得把历史段落当作当前迁移合同。

本轮证明列出的平台自持私钥与归位用例条件，不覆盖存量补建意图的归位退休事务或
迁移前 SWITCHED 历史任务的兼容收敛；相关代码与核验阻断见 `secret-ref-rehome.md`
「独立复核」。不证明尚无消费端的 `SERVICE_CREDENTIAL`、`DATA_KEY` 轮换与组件投递
已经交付，也不证明生产规模积压、全部破坏核验或发布镜像已验收。
OpenBao 版本淘汰只先淘汰 metadata，后续旧数据清理失败返回 warning
（`SF-OBA-13`）；退役终结必须来自显式 `destroy` 后对版本 1 的 metadata 查证，
不能用 `max_versions` 或删除 metadata 代替。

全套命令退出 **0**，35 个本轮测试 namespace 已离线清理、前后集合相等，Core 恢复后
独立 `/healthz` 检查为 **HTTP 200**。实际恢复镜像和显式未运行项见 `native-identity.md`
同日记录；本轮没有删除历史保留 Tenant，也没有修改只读 `.references`。

上述核验当时，`20260930120000_platform_key_retirement` 与
`20260930130000_intent_action_scope` 存在旧 Core 前进兼容问题：旧意图 INSERT 未提供
新增必填的 `key_kind/origin` 与 PROVISIONED 的真实 operation，旧 binding INSERT 未提供
SecretRef 状态，旧 REVOKED UPDATE 也未同步状态，分别与必填字段和新增 CHECK 冲突；
后续 HUMAN 部分唯一索引不能作为旧 `ON CONFLICT (action_execution_id)` 的冲突目标。
隔离空库迁移与当前源码门禁通过不证明运行中旧 Core 兼容。2026-09-30 用户明确当前
只交付全新 Compose 开发环境，无线上旧版、历史数据保留或旧数据库恢复；该兼容问题
在当前交付中无适用对象，不作为开发或发布阻断（`06-工程基线规范.md` §5）。不修改
已应用迁移 checksum，不补造 operation 或意图；上述历史 PASS 保持其实际条件范围。

### 删除完成判据的独立源码复核（2026-10-01）

当前 `core/crates/secret-store/src/lib.rs::version_one_removed` 将任何非空
`deletion_time` 判为版本已移除；`delete_bound_version_one` 的前置查证命中时直接返回
`Ok(())`，不再发送 delete。因此自动删除时间仍在未来且版本未销毁时，当前实现
会误报第一段撤钥完成。这是 `DD-113` 的实现缺陷，不是上游能力缺口。

`SF-OBA-13` 已纠正：OpenBao@`735723da5628148f232497a48a35a137b6512103` 的
`openbao/internal/builtin/logical/kv/path_data.go::versionedKVBackend.pathDataRead`
仅在删除时间早于服务器当前时间或 `destroyed=true` 时返回该版本的 404；未来时间
仍进入读取数据分支。本次用固定 commit 的 `git show` 读取并核对了该分支，未取私钥值。

本次只修改事实与核验记录，未改上述实现、未运行未来删除时间的业务核验，也未登记
修复完成。此前回应丢失、过去删除时间与销毁版本的 PASS 不能覆盖这一输入条件；
Stage 2 私钥生命周期仍不能据历史结果关闭。

### 未来删除时间的生产判据修正（2026-10-01）

本次已直接修正 `SecretStore::version_one_removed`（`DD-113` (3)、`SF-OBA-13`）：
metadata 的 `current_version` 必须恰为 1；`destroyed=true` 保持确定成功，空
`deletion_time` 保持未完成。非空删除时间不再自行解释时钟，而使用原有受超时约束的
HTTP client 读取 `data/<path>?version=1`：200 表示版本仍可读，返回未完成并继续原有
delete；只有 404 携带版本 1 的已删除或已销毁 metadata 才确认完成。401/403 返回
`Refused`；其他状态、传输错误、坏体或版本不符均不形成删除完成证据。没有新增依赖、
配置、业务状态、API 或第二套删除执行器，也没有读取或持久化私钥正文以作比较。

固定上游为 OpenBao@`735723da5628148f232497a48a35a137b6512103`，亲核
`.references/openbao/internal/builtin/logical/kv/path_data.go::versionedKVBackend.pathDataRead`
的未来时间 200、已生效删除或销毁 404 分支，以及
`.references/openbao/sdk/logical/response.go::RespondWithStatusCode` 的实际响应编码；
同 commit 的
`.references/openbao/internal/builtin/logical/kv/path_data_test.go::TestVersionedKV_Patch_CurrentVersionDeleted`
检查了 404 响应的 `data.metadata.deletion_time`。本次只以 `git show` 读取这些源码，
未在 `.references` 执行或构建任何代码。

既有生产调用方保持原语义：`supersede_server_human_key` 未取得证明则返回 503，
不提交 `SUPERSEDED`；`retire_bound_key` 保持 `Retirement::Pending`，不提交
`RETIRED`。Web 的 SERVER 托管私钥使用此链路，Desktop/Mobile 的 CLIENT 本机持钥
没有新增 OpenBao 调用。没有修改身份、权限、审计、租户作用域或退役流程的权威。

先改生产逻辑，之后维护原有
`lost_delete_response_is_resolved_by_deletion_time` 检查及其原有 helper：未来时间
2099-01-01 的 metadata 与数据 200 不能省略 delete；delete 回应丢失后由数据 404
及同版本 metadata 查证。未新增检查脚本、用例或夹具。实际结果：

- `cargo fmt -p secret-store -- --check`：退出 0。
- `cargo test --locked -p secret-store --lib`：15 passed，0 failed，退出 0。
- `cargo clippy --locked -p secret-store --all-targets -- -D warnings`：退出 0。
- 临时仅将生产判据恢复为原来的 `destroyed || !deleted.is_empty()` 后运行上述已有
  lost-delete 检查：退出 101，实际请求数 1 而非 5，明确捕获了省略 delete 的错误。
  随即还原生产修正，同一检查退出 0；再次全量 15/15、fmt、clippy 均退出 0。

编译前实查现有编译进程、CPU 与内存 pressure；执行使用 systemd cgroup 的 8 GiB、
CPU 400%、swap 0，未调低 Cargo jobs，复用
`CARGO_TARGET_DIR=/volumes/data/kailo/core-target-debug`。原始结果：
`/volumes/data/kailo/tmp/codex-secret-delete-check-20261001.log`、
`/volumes/data/kailo/tmp/codex-secret-delete-broken-20261001.log`、
`/volumes/data/kailo/tmp/codex-secret-delete-restored-20261001.log`。

变更前使用 apps 源码根与同引擎 CLI 实际执行了 context、query 和窄 upstream impact；
File 与检查函数的 UNKNOWN 以实际注册及源码调用补证，未按零影响放行。该回执只有
ADR-07 文档 drift，按本批负责人明确授权作窄修复依据，不称全量 fresh 审查。
本轮没有运行真实 OpenBao 未来删除时间的业务集成、更新运行镜像、部署或提交；
单模块结果不代表 Stage 2 全部生命周期或一期发布已验收。

### 同一修正的镜像内复核（2026-10-01）

按 `AGENTS.md` 规则 22 与 `07-运行与运维基线.md` §2.1，本轮使用检查镜像内的
工具链复核上述已完成修正；前一节的宿主结果只保留为当时事实，不作为本轮镜像
门禁通过依据。没有再次修改生产逻辑、增加用例、夹具、脚本或依赖。

实际执行镜像为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
`tools/check.Dockerfile` 配方 SHA-256 为
`0fe3b87a1f6c3b050ced75c841b6962f7e352848a0fb0f9b1dfd1f4ca91b5bf7`。
镜像内实际版本：Cargo 1.90.0、rustc 1.90.0、rustfmt 1.8.0-stable、clippy 0.1.90。
被检查的生产文件 SHA-256 为
`08d895104a97bebaf7a63c6632b4ab1a2e264231f19212f6970ea04aa98904a6`，
`core/Cargo.lock` SHA-256 为
`66130752293c1c29fecf0c7579236535599cb148f944d1ef37c1bcc94bfbc93a`。

执行前由现有 `tools/container-safety.sh` 实查构建进程、CPU 与内存 pressure。
启动前回读 Docker `HostConfig`：NanoCpus 为 8000000000，Memory 与 MemorySwap
均为 17179869184 字节，即 8 CPU、16 GiB 内存且不增加 swap；不是只限制外层 shell。
`apps/core` 只读挂载；依赖缓存与独立的 `/cache/secret-target` 均来自
`/volumes/data/kailo/check-cache`，不与主线的 Rust target 共用输出目录，未调低 Cargo
jobs。镜像内实际执行结果：

- `cargo fmt -p secret-store -- --check`：退出 0。
- `cargo test --locked -p secret-store --lib`：15 passed、0 failed，退出 0。
- `cargo clippy --locked -p secret-store --all-targets -- -D warnings`：退出 0。
- Docker wait 与整个启动命令均退出 0；本次检查容器退出后正常删除，不删除卷或其他容器。

原始输出位于
`/volumes/data/kailo/tmp/codex-secret-delete-container-restored-20261001.log`。
第一次镜像执行中上述三项检查及 Docker wait 已退出 0，但临时启动命令的 EXIT
清理引号错误产生 `rm: missing operand`，使外层命令退出 1；该失败保留于
`/volumes/data/kailo/tmp/codex-secret-delete-container-20261001.log`，没有称为整体通过。
实查并删除该任务自己的已退出容器后，仅纠正本次临时启动命令，以同一镜像和相同
源码重新运行，取得上述整体退出 0；没有修改产品脚本、权限或宿主配置来绕过失败。

真实 OpenBao 的只读服务检查确认本地实例 running、healthy、initialized 且未 sealed。
运行镜像标注的源码版本为 `ccc04f0952a84846330def323da1db6f8416a79e`，不冒充设计
固定版本 `735723da5628148f232497a48a35a137b6512103`。以 `git show` 和 `git diff`
核对两者的 `internal/builtin/logical/kv/path_data.go` 与 `sdk/logical/response.go`，
这些文件的差异为空；此结果只证明已读源码分支一致与服务健康，不证明业务调用完成。
现有 `wrapped_delivery_and_secret_ref_boundaries` 集成入口不调用
`delete_bound_version_one`，且没有证明可安全使用的未来删除时间既有对象；本轮未
创建新身份、密钥或核验数据，也未删除运行中的 SecretRef。真实 future deletion
HTTP 业务链仍未验收，未部署修正，未以本模块结果关闭 Stage 2 或一期发布门禁。

### 同一修正的真实 OpenBao 与成员撤权闭环（2026-10-01）

本轮在上述生产修正之后补齐真实业务 HTTP 证据（DD-70/72/113/115），不新增密钥
轮换动作、检查脚本、种子脚本、用例或夹具。主线统一构建并投递的 Core 实际 image 为
`sha256:69aaf4a2762431246aa311da210e0efe1bf494966aa8d2a748bcf90258ef1e44`，
BFF `/healthz` 实查 HTTP 200；当前 `core/migrations/*.up.sql` 的 36 个版本全部在
`_sqlx_migrations` 中成功应用，无缺失。没有自行构建、重启其他服务、修改只读
`.references` 或接触旧 Kubernetes。已有 OpenBao 运行版本与固定源码的边界保持上一节
登记的事实，不把运行镜像 revision 冒充设计固定 commit。

只使用本轮创建的独立业务 Tenant。部署引导调用现有容器内
`platform-core bootstrap-tenant`；登录使用已登记原生客户端的授权码与 PKCE S256，
管理动作经 AgentGateway 原生入口进入同一 BFF。没有伪造 issuer/subject header，
没有使用用户 password grant、手写 ALLOWED ActionExecution 或直接写数据库授权。
只读数据库查询用于查证 operation、状态与引用，不是推进入口。

完整执行链与实际输出：

1. 现有部署引导先创建 Tenant，等待其 `ACTIVE` 后，只在其独立 KV mount 短暂设置
   原生 `delete_version_after=24h`，随后经同一引导开通第一位管理员。HUMAN 身份由
   既有 `MEMBERSHIP_PROJECTION` 创建，独占 locator 仅写版本 1。
2. 原生 metadata 实查 `current_version=1`、`destroyed=false`、
   `deletion_time=2026-10-02T08:24:05.522225713Z`；在该未来时间生效前，版本 1 的
   数据 GET 实际为 HTTP 200，binding 与 SecretRef 均为 `ACTIVE`，意图未 `RETIRED`。
   数据响应只在受控进程内读取并丢弃，私钥正文未输出、未入库或保存到核验日志。
3. 立即把自己的 mount 配置原样恢复为 `0s`，GET HTTP 200 再查证恢复。已有版本的
   未来删除时间仍保留；本轮没有把该设置作用于其他 Tenant 或部署级 mount。
4. 创建一位独立临时 IdP 用户；第一位管理员经 `tenant.member.invite` 签发邀请，
   第二位用户经现有 `/api/v1/invitations/redeem` 兑换；返回 HTTP 200、`INVITED`、
   `WAITING_APPROVAL`。第一位管理员通过 Temporal 审批，第二位成员取得 `ACTIVE`
   会话，再经现有 `tenant.admin.grant` 获得管理员角色。邀请明文、口令与访问令牌
   只存在于进程内存，不出现在本记录或原始日志中。
5. 第二位管理员提交 `tenant.member.revoke`，目标为第一位管理员。实际返回
   HTTP 202、`WAITING`、`NOT_DISPATCHED`、`WAITING_APPROVAL`；在第一位管理员
   独立批准之前，旧版本数据 GET 仍为 HTTP 200。批准实际经现有审批 HTTP 入口，
   不是直接推进投影、伪造审批或变更权限策略。
6. 撤权投影执行原有 HUMAN 退役链。OpenBao audit 中，这个 locator 的
   `kv/delete/...` 与 `kv/destroy/...` 各有一组相同 request ID 的 request/response，
   `operation=update` 且 response 无 error；没有只凭最终 `destroyed=true` 推断
   delete 曾经执行。原生数据读取随后实际返回 HTTP 404，响应 metadata 的版本为 1、
   `destroyed=true`，metadata 读取仍保留 `current_version=1`。
7. `BuzzIdentityBinding`、其 SecretRef 与成员关系均为 `REVOKED`；意图实际
   `retired_at=2026-10-01T08:26:53.78189+00:00`，`retire_operation_id` 恰为本次
   成员撤权 operation。该 operation 的 Core audit 实查包含 `RETIRED`；业务 Workflow
   为 `MEMBERSHIP_REVOCATION`、`TERMINAL`，TaskProjection 为 `COMPLETED`、
   `observation_gap=false`。第一位用户再次访问会话为 HTTP 403；第二位管理员的
   同 Tenant 会话仍为 HTTP 200。

这证明未来非空删除时间不会使本次生产调用省略原生 delete，并且已取得确定删除与
销毁证据后能够完成既有退役消费者。它不要求等待未来时间自然到期，也不新增等待状态。
未对真实 OpenBao 注入传输中断、500、坏 JSON 或权限拒绝；这些错误的生产 fail-closed
分支仍以此前已完成的源码核对与镜像内既有检查为证据，不把本次顺利链扩写成故障覆盖。
本次没有使用单元结果代替真实 HTTP，也不宣称 Stage 2 全部能力或一期生产就绪已验收。

本轮对象与证据引用如下，保留审计链，不复制私钥或其他上游正文：

| 对象 | 本轮实际引用 |
| --- | --- |
| Tenant | `0db49e83-f4de-4751-9674-41c79759967d`，slug `secret-delete-011635b6c9fc47239c78` |
| 第一位成员 | membership `5f49ba9f-5bf2-47f3-aba5-0fac002a297c`；principal `5c7e0515-8afb-4474-b828-c0ebd1e17ce2`；已撤权 |
| HUMAN 私钥意图 | `0e89d653-a6c9-4d70-abe5-a8302b7149c8` |
| HUMAN SecretRef locator | `tenants/0db49e83-f4de-4751-9674-41c79759967d/kv/buzz-human/provision/0b51f978-5165-489d-a7b3-e18ae0bbd454`，版本 1，已销毁 |
| 第二位临时 IdP 用户 | `secret-delete-9bc49f92047542c0aac6074a0ce371a3`；subject `84c9028a-4e47-4fbf-931f-05cb6319dddc` |
| 第二位成员 | membership `5d265a25-b45a-4a8d-adf2-c83b8f16a8f2`；principal `74fc4d27-8f7b-4569-b947-4eb1d3ef7461`；保留 ACTIVE 管理员 |
| 邀请 | `a36225ee-6a5b-4801-8ac8-23946777544c`；admit ActionExecution `0f7079ef-dbda-4697-bae1-b43decef8760` |
| 撤权 ActionExecution | `2169ba95-412a-4825-83f6-7a63be5d0c29` |
| 撤权及退役 operation | `8f4f0b82-9605-4db1-ae92-2418a1c272d8` |
| 原生 delete audit request | `76b52bba-212e-a686-45b8-8c3dca695a4d` |
| 原生 destroy audit request | `04331459-89fd-54fa-21d7-9c0412610b1c` |

原始成功结果：

- `/volumes/data/kailo/tmp/codex-secret-future-business3-20261001.log`：引导完成、
  未来时间版本可读及自己的配置恢复，整个命令退出 0。
- `/volumes/data/kailo/tmp/codex-secret-future-business4-20261001.log`：真实 PKCE、
  邀请、两次审批、角色授予、撤权、原生 delete/destroy、终态与访问拒绝，整个命令退出 0。
- `/volumes/data/kailo/tmp/codex-secret-future-business-core-audit-20261001.log`：
  同 operation 的 12 条 Core audit 与确定 TaskProjection 终态，只读查询退出 0。

执行前使用已有 `tools/container-safety.sh` 实查并发与压力；本轮一次性运维命令运行在
systemd scope 的 2 GiB、CPU 200%、swap 0 中，只调用现有 Compose 产品二进制和实际
HTTP，不执行宿主 Cargo/Go/Node，也不新增仓库脚本。Core 构建和 SDK 门禁的镜像内
资源限制由各自执行记录证明；本 scope 不被写成运行中全部 Compose 容器都有资源限制。

两次准备命令的错误均保留，不写成通过：首次命令误把现有 bootstrap 的 `PENDING`
退出码 3 当作失败，Tenant 已由原生命周期建立；第二次命令误以为原生 mount 配置的
`delete_version_after` 是整数秒，实际是 Go duration 字符串，引发 TypeError 且该次
finally 未确认恢复。随后只对本轮 namespace 恢复 `0s` 并以 GET 200 确认，再按真实
字符串形状原样恢复，取得上述成功记录。失败输出分别在
`/volumes/data/kailo/tmp/codex-secret-future-business-20261001.log` 与
`/volumes/data/kailo/tmp/codex-secret-future-business2-20261001.log`；没有为这两处
调用错误修改产品、生成新工具或创建第二个 Tenant。

`tools/registry/capabilities.yaml` 中 `lifecycle.tenant_delete` 仍为 `exposure: none`、
无 actions/routes，因此本次未宣称经产品删除 Tenant，也没有直接删库、清审计或销毁
仍在使用的第二位管理员与 CONTROL 私钥。上述临时 Tenant、第二位 IdP 用户、有效
管理员和审计引用保留在本地开发环境，边界与引用已经逐项登记；自己的原生自动删除
配置已恢复。这一保留不影响旧 Kubernetes 或其他项目，也不被写成已完成 Tenant 清理。

## 2026-10-12 ActionToken 首键生产与原 Agent 投递接线

本批四步影响结论：

1. 权威为 `.design/03` §6、`.design/07` §2.5 与原
   `ActionTokenSigningDelivery`。既有 Core signer 已读取版本化私钥并用投递 JWKS
   自验签，但缺少首键生产、公钥导出及原启动文件挂载消费者；IdP JWKS 不可替代。
   OpenBao 固定来源 `735723da5628148f232497a48a35a137b6512103` 的 KV CAS、
   AppRole wrapping 与 Agent template 仍是写入、引导、分发机制。
2. 影响仅原 Core 部署 CLI、`secret-store::write_once` 的多字段原 CAS 消费、
   `start-core.sh`、原环境示例与原部署检查。既有单字段写入委托同一实现；
   无新 schema、数据库状态或业务动作。首键 CLI 需要新增二进制，已冻结的
   `236b` 发布制品不含此命令；已有 signer 消费投递的能力不等于有首键生产者。
3. 初始化不接受业务调用、不监听端口、不注册 SERVICE 或创建 binding。
   用途与私钥同一 CAS 写入；错误或 ACK 不明不覆盖原位置，公钥导出错误不得报告
   完成。Root 引导凭据只经原受控文件和 stdin；Agent 只获专属公钥读策略的一次性
   wrapped secret ID，配置、公钥和日志均不包含私钥。Core 完成后撤销本次凭据。
4. 零组件无签名投递保持启动；半份或歧义配置拒绝。首键并发写冲突由原 CAS 与
   精确字段比对拒绝，重新进入只读原版本；已轮换版本不回退。Agent 超时、文件
   错配、读回不符均非成功，只清理本次精确短命运行体，不停止业务服务。
   公钥元数据不代替资源授权、quota 或 release/binding 门禁。

本批原 Rust、部署消费者与真实 OpenBao/Agent 均已执行；没有部署新业务 Core、
注册 release 或激活 binding。已冻结、尚未部署的 `236b` 制品没有新增 CLI，不能据此改写其来源。
验证输入与原命令日志目录：
`/volumes/data/kailo/tmp/receiver-binding-lifecycle.VredXg/tmp/action-token-bootstrap.saKgg5`。

执行入口和真实结果：

- 原 SDK `kailo-receiver-binding-check` 回读为 `4 CPU / 8 GiB / swap 0`、UID 1000、
  只读根与 Data 挂载，执行前仅 sleep，宿主可用内存 35 GiB。固定 SDK image 为
  `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。
  未新增 Cargo target、下载依赖、构建或加载镜像。
- `cargo test --locked --offline -j16 -p secret-store deterministic_multi_field_write_keeps_one_cas_and_rejects_partial_or_changed_intent -- --nocapture`：
  1 passed；`cargo test --locked --offline -j16 -p platform-core --bin platform-core bootstrap_public_key_verifies_the_original_pem_signer_without_private_fields -- --nocapture`：
  1 passed；外层 56757 退出 0。首次 65043 因错误指定不存在的 `stable` toolchain
  退出 1；改用 SDK 原固定 1.90.0，不安装或升级。
- 私有删除逐字段相等判断，原 CAS 测试明确在不同 key 意图断言失败，1768 退出 101；
  原字节恢复后相同 lib 过滤 1 passed。随后同 SDK 原
  `cargo build --locked --offline -j16 -p platform-core --bin platform-core` 完成，
  82996 整体退出 0。该新引导二进制 SHA256
  `ed7ebb8e3fd1429875c30ca9369d3b4a7600569c7edd92b822ed1bb75ca64133`。
- 原 `tools/check.sh::step_security` 中实际 adapter/ActionToken 投递消费者原样执行，
  45849 退出 0；私有移除 `secretAudience` 校验，44012 退出 1，命中同名否定断言；
  恢复后 54930 退出 0。完整 step_security 初次 48098 退出 1：窄快照没有真实 Git
  ignore 上下文及设计文件，新增投递段本身通过，不能称整安全门禁通过。
- 原 Core `bootstrap-action-token` 在一次性 `4 CPU / 8 GiB`、只读根、app 网络的
  同固定 SDK 镜像中运行，使用原 AppRole wrapping 生产者，首次 Core 退出 0，
  外层 42540 退出 1 是把原 JSON 日志加结果当单一文档的证据解析错误。修正运维
  解析后仅对同引用重入，8278 退出 0，`secretVersion=publicJwksVersion=1`；
  原 Core 读回已存在首版，不重新生成或覆盖私钥。
- `start-core.sh` 中原 `PYACTIONAGENT` 片段直接执行，50342 退出 0。public-reader
  仅有该公钥 data 路径的 read policy；Agent 的一次性 wrapping 投递、版本固定模板、
  公钥 JSON 与 Core 导出一致均真实通过。Agent `2 CPU / 2 GiB`、无 swap、非 root，
  两个精确 Core 短命容器与该 Agent 已清理；缓存、秘密引用和日志保留。

真实公钥位于
`/volumes/data/kailo/tmp/cells-upload-delivery.3TQNvd/action-token/public/jwks.json`，
SHA256 `399e117f9c267683f72ab53f03f825b45c0a4dc106f6c583cd8cdb006cca4ce0`。
同级上层 `signing.json` 只含版本化引用：私钥位置为
`platform/kv/action-token/kailo-upload-sync-service-20261012-3tqnvd`，公钥位置为
`platform/kv/action-token-public/kailo-upload-sync-service-20261012-3tqnvd`。
两者均为专属 fixture，不复制线上私钥，不把此公钥称为尚未部署的独立 receiver Core
已消费。私钥只在 Core 内存与 OpenBao，未写入宿主文件或日志；运行文件中的一次性
wrapping 凭据不是私钥，也不交给浏览器。原平台身份、业务数据及线上 Core 未改动。

原件 SHA256：`core-positive-correct-toolchain.log`
`f5eeeabbccdbb70c74a1d661a0cdb4657086f74e06cd834314719be894ada0a1`；
`cas-mutation.log` `d2241a7965c5a71992b86c9977c035bea28c1f02e81efa2da68962c3886d90c3`；
`cas-restored-and-cli-build.log` `39da60d415e7780559e5c65f9e61b02a584f5acb404b70ac3f6873ea8d8a7085`；
`deployment-mutation.log` `f931255d5f9b9ade32f49cf78e239956c253b0c2d0afd7d4b683e97c5c5a91f5`；
`deployment-restored.log` `1323cc829e9d396cb03ff0272215e0352d361040b9ace5eaf1bd491ff205eedb`；
`real-first-key.log` `dbf9f9f34513cca3d2106935938ef27ac89aac25ef53e8a3d16d2879db612f31`；
`real-same-key.log` `806175221d79bde4ea98d90c713ea278dd6e2c9bf486ce025c81c852ac8cd36b`；
`real-public-agent.log` `a22c6d01caded84384195560ecc43d8b943bb6977c3e0f9dad8e7fc16b59d5b4`。
