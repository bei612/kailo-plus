# SS-BUZ-OPERATOR 与 SS-BUZ-COMMUNITY-DELETE 接缝证据

## 符号可解析（2026-09-22）

在 `779af8886caae1317b4de962082429867ab61503` 上确认：

| 符号 | 文件 |
|---|---|
| `authorize_operator_request` | `crates/buzz-relay/src/api/operator.rs` |
| `check_operator_replay` | `crates/buzz-relay/src/api/operator.rs` |
| `provision_community` | `crates/buzz-relay/src/api/operator.rs` |
| `relay_operator_api_origin` / `relay_operator_pubkeys` | `crates/buzz-relay/src/config.rs` |

## 三条已实测的性质

历史核验入口现位于 `core/crates/collab-bridge/tests/operator.rs`。本节记录其对运行中 Relay 的既有核验结果，不表示本批重新执行：

| 性质 | 结果 |
|---|---|
| audience 不符时在发请求之前失败 | 通过。同一把 operator key 不得服务它不该服务的部署 |
| 签名 URL 用错 origin 时不可能通过 | 通过。origin 是配置而非入站 `Host` 头推导，代理后不会被顶替 |
| 同一 owner 重发幂等、换 owner 被拒 | 通过。前者让「行已建、owner bootstrap 崩溃」之后的重试能收敛；后者是 `REQ-09` 的落点 |

## 上游语义的两处澄清

**`create_only` 不是「存在即失败」。** 字段文档写的是「reject an existing host
instead of converging」，实测并非如此：`create_community_with_owner` 在 host
已存在时会按 owner 再查一次——owner 相同则返回既有 community 并报
`status: "created"`，只有 owner 不同才返回 `HostExists`。

这对 Kailo 是好事而不是问题：真正要防的是两个 Tenant 共用同一协作空间，
而那恰好是 owner 不同的情形。但 Core 不得把 `create_only` 当成通用去重手段，
Tenant 唯一性仍由 `identity.tenant` 的 slug 唯一约束保证。

**owner 不是 operator。** 按 `.design/09`，operator 只负责签名创建请求；
创建后的 relay-level roster 用 Tenant CONTROL 身份。核验最初拿 operator
当 owner，很快撞上每 owner 的 Community 数量上限——上游对单个 owner
可拥有的 Community 数有硬上界。

## 历史核验残留的边界

历史清理对 Community 直接执行数据库删除时，被 `audit_log` 外键拒绝。这不等于固定版本没有整社区删除能力。`DD-109` 要求使用原生删除阶段机，而不是直接删除 Community、删除审计行或以归档冒充删除。Core 的永久审计与 Buzz 的原生删除检查点、审批证据各自保持权威；固定版本的整社区删除按原生清单处理 Buzz 社区数据，并永久保留 Community 名称墓碑。

## 私有删除执行器的源码收口（2026-09-30）

固定上游为 `779af8886caae1317b4de962082429867ab61503`。本批通过 `git show`、`git grep` 与 `git ls-tree` 重新核对下列源码，未执行或修改 `.references`：

| 固定源码路径 | 可解析符号及边界 |
|---|---|
| `buzz/crates/buzz-deletion/src/lib.rs` | `run_with_services`、`execute_claim`、`run_stage_with_heartbeat`：复用原生清单、阶段、租约、检查点与心跳，不以 CLI 输出或退出码作为业务终态 |
| `buzz/crates/buzz-db/src/store/deletion.rs` | `DeletionStore::submit`、`freeze_inventory`、`approve`、`claim_specific`、`inspect`：审批绑定原生冻结清单，原始 submit 的幂等窗口仅覆盖同 requested_by 的 submitted 请求 |
| `buzz/migrations/0029_community_deletion.sql` | `prevent_community_deletion_request_retargeting`、`prevent_community_deletion_approval_removal`：冻结清单在所有阶段不可改写，审批证据不可更新或删除 |
| `buzz/migrations/0030_community_deletion_recovery.sql` | `community_deletion_requests_active_community`：同一社区只能有一条非 aborted 请求 |
| `buzz/crates/buzz-relay/src/api/operator.rs` | `authorize_operator_request`、`check_operator_replay`：既有部署级 operator origin、allowlist、NIP-98 方法与载荷绑定、operator-management 重放域 |

本地执行路径为 `buzz-relay/src/main.rs::serve` → 独立私有 listener → `buzz-relay/src/deletion_executor.rs::build_router` → `buzz-deletion/src/lib.rs::DeletionExecutor` → 原生引擎。`BUZZ_DELETION_BIND_ADDR` 没有默认值；配置时必须已有 operator origin 与非空 operator pubkey allowlist，且监听端口必须与公开 Relay、health、metrics 分离。该 Router 不合并到公开 Relay Router；部署不得将私有 listener 发布到宿主或公开代理。

| 私有请求 | 实际行为 |
|---|---|
| `POST /operator/deletions` | 仅接受 host 与 TenantDeleteSubprocess UUID；归档条件与插入共用社区行锁，重试观察既有非 aborted 请求，不替换请求、不解除归档 |
| `GET /operator/deletions?host=…` | 按精确 host 查全非 aborted 请求，包含 blocked 请求；不从有上限的部署全局 list 截取后再过滤 |
| `GET /operator/deletions/{id}` | 返回原生 request、approval 与 checkpoints，不改名或合成 Tenant 状态 |
| `POST /operator/deletions/{id}/approve` | 校对原生 frozen inventory digest 与 ActionExecution UUID，再复用原生 approve 事务；同审批重试只观察原始证据，不回退阶段或自动解除 blocked |
| `POST /operator/deletions/{id}/run` | 复用原生 claim、执行与 inspect；HTTP 断连不取消由进程 TaskTracker 持有的执行任务，Relay 排空取消并等待该 tracker |

所有私有请求复用原 `authorize_operator_request`，签名使用唯一配置的 operator origin 而非私有监听地址或入站 Host。没有 abort、unblock 或 taxonomy sweep HTTP 路由，这些仍由既有运维 CLI 管理。PG、S3、Redis 客户端只在 Buzz 进程内复用，不向 Core 或 Worker 投递这些凭据。

本批不注册 `tenant.delete`，不表示 Core、Worker 与部署凭据链已经闭合。HTTP 200、原生 run 返回或单独 `retention_pending` 都不构成 Tenant `DELETED` 证据；按 `DD-109`，仍须同一请求的终态 inspection 与以 CONTROL pubkey 作为 owner 筛选的 operator Community list 中不再出现目标 host 两份证据。blocked、租约占用、传输失败和结果不明均不伪装成终态成功。

## 本批实际验证范围

源码修正后执行：

```text
cargo check --locked --offline --manifest-path collaboration/Cargo.toml -p buzz-deletion -p buzz-relay --all-targets
    Checking buzz-deletion v0.1.0
    Checking buzz-workflow v0.1.0
    Checking buzz-relay v0.2.1
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.78s
Main processes terminated with: code=exited/status=0
```

实际命令由 `systemd-run --user` 启动，Rust/Cargo 为宿主既有 1.95，明确现有 Cargo PATH、`CARGO_HOME` 与共享 target，设置 `SQLX_OFFLINE=true`；cgroup 为 `MemoryMax=8G`、`CPUQuota=400%`、`TasksMax=8192`，未降低 Cargo 默认并行度。启动前核对既有编译进程、CPU 与内存压力。第一次检查因 systemd 用户 PATH 选到旧 Cargo 而在读取 v4 锁文件时退出 101；仅改为既有 Cargo 绝对路径后通过，没有更改锁文件或安装工具链。

`git diff --check` 对本批跟踪文件无输出、退出 0。针对性源码交叉复核修正了一个问题：原生 executor heartbeat 以 executor ID 为主键，私有服务并行运行不同社区时必须每个 run 分配独立 UUID，不能共用一个 listener 级 ID。原有阶段、租约、检查点、审批表与 CLI 不变。

本节是编译和源码复核证据，不是 HTTP 或数据库删除验收证据。本批没有启动删除私有 listener，没有执行真实社区删除，没有验证断网重连、审批重投、故障恢复、被占用租约或终态 Community list 的运行结果，不能据此宣称整条 Tenant 删除业务已经可用。

## 实际开发产物与部署（2026-10-01 UTC）

既有 `tools/build-upstream.sh collaboration-relay` 实际退出 `0`，镜像推入本地 registry 后摘要为 `sha256:bba42d49e889da6adb9bfd7d60807a72cc0cff06928062c2112370f827bf6df9`；原工具记录的源码摘要为 `sha256:1baf838fac62863ac36ee6ff12396d0308f6052609b936628048ceec646dfe00`。构建共用已有 BuildKit cgroup，内存上限 16 GiB；实际 CPU 配额由 400% 提到 800%，Cargo 原并行度不变。日志为 `/volumes/data/kailo/tmp/codex-private-delete-relay-artifact-20260930.log`。

同一源码输入覆盖的 Desktop 安装包也由原构建工具实际生成，退出 `0`；包字节摘要 `sha256:52061409c760b4286046dd553fb02ad2df3fa8e32c51982ec3a54817c8decff3`，源码摘要 `sha256:6dd3a9737a17e0225a1183520212120a9e17ccf8c259f00da131610cbf1f3260`。既有来源记录、Compose 的两处 Relay image 与相关追溯 release.digest 均按真实产物机械同步；没有以手填摘要代替构建，也没有安装或启动 Desktop。日志为 `/volumes/data/kailo/tmp/codex-private-delete-desktop-artifact-20260930.log`。

随后仅重建本地 Compose 的 `buzz-relay` 运行单元，实际 image 为上述新摘要，容器 `running/healthy`，`/health` 为 HTTP `200`。容器环境中没有 `BUZZ_DELETION_BIND_ADDR`，私有 listener 仍关闭；没有发布私有端口或注册用户删除动作。部署与运行日志分别为 `/volumes/data/kailo/tmp/codex-private-delete-relay-deploy-20261001.log`、`/volumes/data/kailo/tmp/codex-private-delete-relay-runtime-20261001.log`。

这些产物来自当前完整开发工作树，不是选定提交的生产发布证明；普通 Relay 健康不证明私有执行器删除或 Core/Worker 编排通过，上一节的未验收边界保持不变。

## Core 原生删除客户端（2026-10-01 UTC）

`core/crates/collab-bridge/src/operator.rs::OperatorIdentity` 已接入私有执行器的五个实际方法；依据为 `DD-99`、`DD-109` 与 `apps/02` §5 的 Stage 3 删除链。客户端没有第二套删除阶段机，不链接数据库、对象存储或 Redis 客户端，不接收这些凭据。

| 客户端方法 | 请求与原生响应 |
|---|---|
| `submit_community_deletion` | `POST /operator/deletions`，host 与 requested_by；返回完整 `DeletionRequest` 对象 |
| `list_community_deletions` | `GET /operator/deletions?host=…`，原始查询串与请求一致；返回精确 host 的完整非 aborted 请求数组，包括 blocked 请求 |
| `inspect_community_deletion` | `GET /operator/deletions/{id}`；返回原生 request、approval 与 checkpoints |
| `approve_community_deletion` | `POST /operator/deletions/{id}/approve`，expected_inventory_digest 与 approved_by；返回完整 `DeletionRequest` 对象 |
| `run_community_deletion` | `POST /operator/deletions/{id}/run`，实际 body 为 `{}`；返回完整 `DeletionInspection` 对象 |

本批重新读取固定 `779af8886caae1317b4de962082429867ab61503` 的 `buzz/crates/buzz-db/src/store/deletion.rs::DeletionRequest`、`DeletionStage`、`DeletionInspection`、`DeletionApproval`，并对照已实现的 `collaboration/crates/buzz-relay/src/deletion_executor.rs` HTTP handler。原生阶段序列化为 snake_case，inspection 为 request、approval、checkpoints 三个字段；inventory_digest 是原生裸十六进制值，不加平台 digest 前缀。五个客户端方法均返回完整 `serde_json::Value`，不截取原生证据、不把未知阶段映射成既有状态。

requested_by 入参为 TenantDeleteSubprocess UUID，approved_by 入参为 tenant.delete 的 ActionExecution UUID，序列化为字符串；客户端不自行生成业务关联 ID、不自动重试，不把一个新的 nonce 当成新删除业务。提交结果不明后的精确 host 回读、原生请求复用、审批和双终态判定由实际生命周期调用方承担，不能从客户端 HTTP 成功推出 Tenant 已删除。

`deletion_request` 显式接收私有 HTTP(S) transport origin，不读环境变量、没有默认地址，不回退到公开 operator 服务。transport 带凭据、路径、查询串或 fragment 时在发送前拒绝。`request_json` 沿用既有 `nip98_header`，签名 URL 始终来自 `RelayOperatorIdentity.relay_operator_api_origin` 加实际路径和原始查询串；私有 transport 只替换网络 authority。POST body 只序列化一次，同一份字节同时用于 payload 摘要与发包，每次请求签发新 nonce。Relay 的 `authorize_operator_request` 不读取入站 Host，因此客户端没有伪造 Host。原有创建、归档、解档方法通过共同请求函数保留既有协议。

本批实际执行，均退出 `0`：

```text
rustfmt --edition 2021 core/crates/collab-bridge/src/operator.rs
cargo check --locked --offline -p collab-bridge --all-targets
    Checking collab-bridge v0.0.0
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 6.91s
Main processes terminated with: code=exited/status=0
cargo clippy --locked --offline -p collab-bridge --all-targets -- -D warnings
    Checking collab-bridge v0.0.0
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.77s
Main processes terminated with: code=exited/status=0
```

两次 Cargo 命令均先检查既有编译进程、CPU 与内存压力，再通过 `systemd-run --user` 在 `MemoryMax=8G`、`CPUQuota=400%`、`TasksMax=8192` 的 cgroup 中执行；使用宿主既有 Rust 1.95、`/home/ubuntu/.cargo`、`/volumes/data/kailo/core-target-debug` 与 `SQLX_OFFLINE=true`，未降低 Cargo 并行度。原始输出分别为 `/volumes/data/kailo/tmp/codex-delete-client-check-20261001.log` 与 `/volumes/data/kailo/tmp/codex-delete-client-clippy-20261001.log`。

本节仅记录客户端实现与编译证据。没有运行真实社区删除，没有运行故障注入、审批重投或终态双证据验收；没有以编译成功声称 Core、Worker、部署私有 transport 与 tenant.delete 全链已经验收。

## 同一冻结清单的共享 CAS 保留证据（2026-10-02 UTC）

原生 `buzz-deletion::build_inventory` 现从目标 Community 的历史 sidecar 与 Git pointer 版本解析实际引用对象，将对象数量、字节数与规范化 key/version/size 摘要写入既有 `FrozenInventory.retained_cas`，随原生 inventory digest 冻结。缺少该证据的历史序列化仍可读取，但不能通过原生批准或执行校验；既有 `retention_pending` 检查点携带同一份保留证据。不以全桶量、前缀删除量或固定零替代归属证明，不物理回收共享 CAS。

Relay 原来的 Git manifest 解析、校验与 hydrate 实现已移至 `collaboration/crates/buzz-core/src/git_manifest.rs`，原 Relay 路径删除并登记在 `remove_paths`；Relay 与删除引擎都消费这份实现，没有第二套解析器。固定上游依据仍为 `779af8886caae1317b4de962082429867ab61503` 的 `crates/buzz-relay/src/api/git/manifest.rs`、`crates/buzz-db/src/store/deletion.rs`、`crates/buzz-deletion/src/lib.rs`。

两次资源受限 SDK 的原始输出分别为 `/volumes/data/kailo/tmp/codex-tenant-delete-native-compile-20261002.Twor9o/sdk-verify.log` 和 `/volumes/data/kailo/tmp/codex-tenant-delete-parser-mutation-20261002.Y4ZqWK/restored-and-final-native.log`，实际均 `sdk_exit=0`。前者原生既有检查合计 295 passed、267 ignored，Relay all-targets 编译通过；后者在最终缺证据拒绝修正后重复执行原 deletion 检查，17 passed、9 ignored。同目录 `mutated.log` 中原解析器检查面对临时 Data 副本中的错误 guard 实际退出 101，恢复字节后通过；工程源码未写入该错误。详细范围、失败和跳过记录见 [Core 销毁证据](../../../core/verify/tenant-deletion.md)。

这些日志验证当时冻结源码的窄实现，不是本提交候选的集成验收，也不是实际 S3/数据库 Community 删除正向链验收。上述核验时新共享 CAS 证据尚未构建部署；随后候选构建事实见下节，仍未部署、未开放用户删除入口，不以源码合并、编译或原生 `retention_pending` 单独宣布 Stage 3 完成。

## 候选 Relay 工件来源收口（2026-10-02 UTC）

在候选目录 `/volumes/data/kailo/tmp/codex-delete-commit-candidate-20261002.KBSv5P` 使用原 `tools/build-upstream.sh collaboration-relay`、原 Dockerfile 和已有 `kailo-core-data` builder，实际 helper 退出 `0`。最终三个原生二进制编译完成，镜像经官方入口 load、tag、push、record；未改业务源码或构建配方，未重启任何运行服务。registry authority 仅从正式 `deploy/local/.env` 的非密 `REGISTRY_HOST` 取得，没有投递或输出整份环境文件。

原算法纳入的 1118 个输入在构建前、helper 实际暂存目录及构建后重算均为 `sha256:cf87de56f571ad03a102ffed330e5218789beb48448495a7921c082e28e4c797`。helper 原工具登记的镜像摘要为 `sha256:2ea8059fd418cff927ad8122980917f996915eb2c8c789ac1e7a995b21479158`；registry manifest GET 实际返回 `200`，其正文 SHA、`Docker-Content-Digest` 和来源记录摘要三者相等。既有两条 Relay 追溯仅机械同步该摘要，没有改变能力状态或 exposure。

原始证据位于 `/volumes/data/kailo/tmp/codex-candidate-relay-official-20261002.kjTzTo/`：`helper.log`、`build-collaboration-relay.W8WQGQ.log`、`exit.log`、`source-before.log`、`helper-stage-proof.log`、`source-after.log`、`registry-proof.log` 与 registry 响应原件。实际 helper 暂存输入保存为 `helper-stage.tar`，SHA-256 为 `0c6b2cb8a629eb23e0c6944d9866b766962c748a8e72c1fd6c6654f0810e2c79`。第一次只读 registry 核验因遗漏候选 Git 环境而在 plan 阶段失败，尚未请求 registry；错误保留为 `registry-proof-initial-error.log`，补齐与成功 helper 相同的私有 Git 环境后核验退出 `0`，没有重建或修改工具。

构建前实际检查已有进程、CPU/内存压力和 builder 限额。Windows 与 Relay 由主代理批准共用一个合计 8 CPU、16 GiB 的 BuildKit 父 cgroup，而非各占 16 GiB；Docker `MemorySwap` 为 16 GiB，但内核 `memory.swap.max` 实际为 `max`，宿主 `SwapTotal=0` 且没有交换设备，不能写成内核 swap 上限为零。原件为 `preflight.log` 与 `kernel-limits-before.log`、`kernel-limits-after.log`；终态父 cgroup 的 `memory.events` 中 max、oom、oom_kill 均为 `0`。没有降低 Cargo 并行度、另建 builder 或安装宿主 SDK。

这只证明该候选 Relay 输入对应的真实镜像构建与登记；未部署、未验收实际 Community 删除、共享 CAS 对象归因读回、四 provider 合流或取消竞态。公开删除入口仍关闭，不能据此宣称 Stage 3 或一期生产就绪完成。
