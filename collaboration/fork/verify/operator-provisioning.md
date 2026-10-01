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
