# Core/Worker 发布产物核验（2026-09-26，2026-09-29 追加）

对应 `ADR-06`、`00-实施总纲.md` Stage 0 第 7/8 项与
`03-验证发布与验收门禁.md` §5。本记录只证明本机固定提交的两个自建发布单元；
不把本机 provenance 断言等同于远端签名或三端发布验收。

## 固定输入与资源边界

- 源提交：`4e0dc502a118cf45c99048e39928ee943ebc47e6`；工作树干净。
- `release.sh` 从该提交的 `apps/` tree 导出 `.dockerignore`、`core/`、`worker/`。
  归档必须由仓库根执行；在 `apps/` 下执行原命令稳定报
  `pathspec '.dockerignore' did not match any files`，修正命令退出 0。
- 构建前确认无其他 Cargo/Rust/Go 构建进程。使用
  `BUILDX_BUILDER=kailo-core-limited-20260925`，其 BuildKit 容器实际配置为
  `memory=25769803776` 字节、`CpuQuota=1000000`、`CpuPeriod=100000`；
  脚本外层另由 `systemd-run --user --scope -p MemoryMax=2G -p CPUQuota=200%` 约束。
- 根盘在构建期间最低观察到约 48 GiB 可用；没有删除或重启旧 K8S 的资源。

## 实际运行

```text
env BUILDX_BUILDER=kailo-core-limited-20260925 \
    KAILO_BUILDER_ID=kailo-core-limited-20260925 ./tools/release.sh
exit 0
core image  sha256:c970190c38de308ce2467ea78ad9898fb76d067f78711642a23a1cfd9c5360ba
worker image sha256:7abd2c5501e90f849134d6db357b7447f97f187e24fb04e9ec8d534c7d3ed0f4
```

两个 digest 均由 `docker image inspect` 对该提交的 tag 独立回读，
与各自 provenance 的 `subject[0].digest.sha256` 和文件名一致。
各自的 SPDX SBOM 与 provenance 都已实际生成；provenance 的 `gitCommit`
均为上面的 40 位提交，依赖锁摘要均为
`7e9525d5f5451335342ebcc16e0975a3ccfedb18c2af36a3addc29ea40f6b3ef`。
该摘要由提交中 `apps/core/Cargo.lock`、`apps/pnpm-lock.yaml`、
`apps/worker/go.sum` 的 Git blob ID 按路径序拼接计算，不依赖当前工作树内容。

`./tools/check.sh supply` 在原样产物上退出 0，报告 12 个现存 digest 的
SBOM、provenance、commit 与锁摘要一致。分别把本次 Core provenance 的锁摘要
首位和 subject digest 首位改错，检查均退出 1，明确报告对应不匹配；恢复两个
字段后再次退出 0。`dist/` 不入 Git，原样产物留在本机供复核。

## 2026-09-29：功能目录重构后的发布单元

- 源：`tools/release.sh` 从提交 `076681d`（ADR-16 目录重构）的 `apps/` 构建。provenance 中的
  `gitCommit` 为 `dae9abd5954a05019ea5ab89e3e4050d8da94341`，该提交只改仓库根的 `AGENTS.md` 与
  `CLAUDE.md`，`git diff --quiet 076681d dae9abd -- apps` 退出 0，两者的 `apps/` 树相同。
- 产物（产物名按 ADR-16 改为 `core`、`worker`）：

```text
core   sha256:7e9b800d79e791b003ca10b1091e98b24b1756a56afa94b360ee631a792ae8c2
worker sha256:9e7d3a6d48b1d0281974db4806a307d44f3f30b72348c76a1bb3c18707bfd46c
```

- `dist/` 下各有 SPDX SBOM 与 provenance（`core.<digest>.spdx.json`、`core.<digest>.provenance.json`，
  worker 同）；provenance 的 `subject[0].digest.sha256` 与文件名一致，`externalParameters` 为
  `dockerfile: core/Dockerfile`（worker 为 `worker/Dockerfile`）、`context: apps/`，依赖锁摘要为
  `7fb91d1a70c935f857e07bdec20bd68de5983f71abd2fcfb0acafb65a6a77b77`。
- 14 份追溯记录的 `release.artifacts` 改登记这两个 digest（提交 `9566ac0`）；随后
  `tools/check.sh trace`、`seam`、`supply` 通过（同一提交说明）。
- 本段不含对这两个 digest 的破坏核验与回滚演练；重构后的行为回归见
  `core/verify/functional-layout-regression.md`。

## 未被本记录证明的边界

本地镜像尚未作为 OCI referrer 连同 SBOM/provenance 推送到共享 registry，
也没有远端签名及部署前验签；这按 `ADR-06` 在出现共享 registry 时启用。
本记录不证明 Desktop/Mobile 的安装包供应链，也不代替 Stage 2 业务门禁。

## 2026-10-03：公开 Memory 批 release 与限定部署

源码来自已普通 push 的 `4b44ac6b266345fbc19e3c315df5c3d9bd0af00b` clean 私有快照，
origin 为实际 `git@github.com:bei612/kailo-plus.git`；不纳正式工作树的后续功能。
原 `tools/release.sh` 完整退出 0，源码 Git blob 回执前后逐字相等；
没有重建 Runtime `ad13c952…`、Web `97bc2379…`、Relay `d42f83fa…` 或 Win11 `5378f370…`。

```text
core   sha256:577c274086d1528c30c41fef92d47066a555a3c2c06ac335fe8e4f1c9e93fa6f
worker sha256:d10b518458921cf2ff400e9069f5fe2905aae567f6c81a3410e194a469f3b78c
```

两项原 registry push 均为 0，OCI manifest GET 均 HTTP200，正文 SHA 与 digest 相等。
原 syft 生成的 SPDX/SLSA provenance 均实存于项目 ignored `dist/`，subject 对齐上列产物；
源 commit 均为 `4b44ac6b…`，依赖锁摘要均为
`76be59e4720e1f1f2653857787fd9bc712fbaeda83fb919746c5daf9ef32eb27`。
按 Core provenance、Core SPDX、Worker provenance、Worker SPDX 次序，四份文件 SHA-256 为：

```text
391525447407c93415ad9cbf3d39542810a030006c7d6efad9bf064df365b73a
0081d410cfd5aade8dfe0d596472b5973053ea4c7ef9a77e2709ae693e6cd7c7
9d3db14a54f8f1ac4ccd8656793ced444b07334715767fad44bed237a1d2c9ac
e97659206c70c61c06cb2143b3bc58a9e4184db84b7a6feeeacd8f003548a589
```

原安全入口返回 0。实际 BuildKit 父 cgroup 为 8CPU、16GiB、swap0，
Data 缓存不变；没有以宿主无 swap 推断限额，没有降 Cargo 并行度。
完整原件在 `/volumes/data/kailo/tmp/codex-memory-core-worker-release-20261003.j7LhAk/`；
`release.log` SHA-256 为 `b9b6534ef28103edc355803b062b03d9e734cf4f8a8ccdc1527763769eb02ecc`。
原 `migrate_core_database` 对在线库仅 forward，50 条迁移前进至 53 条且全部成功，
没有 rollback、删库或业务 seed；`live-forward.log` SHA-256 为
`e2bfc8ab4524df697d5166272cff4168c35856ebaca62f1a7dd94a31a579cbc5`。

首次原 `start-core.sh --no-build` 因私有快照未投递相邻 `.design` 而在 registry 预检退出 1，
发生于 wrapping/create 前，旧 Core/Worker 未动。使用原脚本支持的
`DESIGN=/volumes/kailo/.design` 后退出 0，正常取得三份新的一次性 wrapping；
不重用已消费凭据，不改工具或设计正文。Core 首次过早 curl 56 保留，随后 healthz 为 0。
仅替换 Core、Worker、Web、Relay，Worker 启动原 Task Queue，Web/Relay 原 healthcheck healthy。

首次对照发现原 OpenMeter Kafka 在替换前的 `06:18:27Z` 退出 137/OOM。
主线明确授权后只执行一次原容器启动，`06:37:03Z` 同 ID/镜像/volume/参数恢复 healthy。
原 OpenMeter 鉴权 Customer health 脚本独立 HTTP200/退出 0；原 Kafka consumer 查询退出 0，
真实 `openmeter-sink-worker` member 已连接，但 `om_default_events` log-end-offset 为 0。
Kafka 原有效 JVM 为 `-Xms1G -Xmx1G`，实际 cgroup 为 2CPU/1GiB/swap0，
heap 等于总内存 limit；未调整配置，不能声称重复 OOM 风险已消除。
最终 28 个平台容器中 24 running：四个替换、Kafka 同 ID 一次恢复，其他 23 个所有
原对照字段逐字相同。保留首次失败、137/OOM、恢复及 health/consumer 原件。
live Compose 使用此 clean Data 快照，受控 secret/data 仍绑定唯一正式投递目录，
下一原部署替换前须保留该快照与绑定，不将临时目录清理当作业务数据清理。

四步结论：复用既有发布、wrapping 与部署权威；影响为真实产物指针、三条 forward
迁移和上述限定服务操作；权限、正文瞬态、UNKNOWN 与 native stored 权威不变；
原 full1/full0/SKIP/ignored 保留，健康不代替真实 Memory/计量 E2E、AGENT 运行或
Win11/Mobile 设备验收，亦不证明远端签名或部署验签。

## 2026-10-03：3d8c0c1 checkpoint Core/Worker 产物

唯一输入为公开提交 `3d8c0c11285fbf1cfa447ba21e465842ceb4abf3` 的 clean Data
clone，origin 为实际 Github 来源。原 `tools/release.sh` 一次退出 0；
整树输入前后 SHA-256 均为 `9738c33b20bbc6ceda87c6c4dec19e0fd374d82e5dd0bdd54823a4c3af23b9bb`，
clone 仍 clean，不纳后续工作树。复用登记 Runtime `ad13c952…`，没有重建它。

```text
core   sha256:e51b71ff686be05af1e3e0db252883f25baa32c3e8deae0a03c87a6b3ccbc350
worker sha256:dcbbbd6cf583048aad89ee996d37ec201be829c292f3e4d717cfba07eb8eb0f0
```

两项正常 registry push 均退出 0，HEAD/manifest GET 均 HTTP200，manifest 正文
SHA 与上列 digest、原 SPDX/provenance subject 一致。四份原 syft/SPDX/SLSA
文件实存 `dist/`；依赖锁摘要仍为 `76be59e4720e1f1f2653857787fd9bc712fbaeda83fb919746c5daf9ef32eb27`。
原 `tools/check.sh supply` 退出 0、SKIP/FAIL 均为 0；未安装 gitleaks，
原上游 added-lines 内置扫描 PASS，2 个真实产物的 SBOM/provenance/commit/锁摘要 PASS。

实际执行者为既有 `kailo-core-data`，8CPU/16GiB，父 cgroup swap0、
max/oom/oom_kill 均为 0，Data 缓存与配方不变。Core Rust 原层成功后
才释放 Win Rust 窗口，Worker Go 接续；没有降低并行度或另建 builder。
原件在 `/volumes/data/kailo/tmp/codex-final-core-worker-release-20261003.CepL5P/`；
`release.log` SHA 为 `d85388a736d0e92e469ee2378cf8572d70756d58696e7867e95fee7963edaeeb`，
`supply.log` SHA 为 `a1cc6f7bea5391b1d43d6003d84ee1cbad5ee39ca027ec02af49bce6f8a910b3`。

四步结论：既有 clean-commit release、Runtime 与 registry 为原权威；
影响仅真实产物及已有 Trace digest；未改业务、权限或运行配置；
失败保持原证据，此次未运行 full、部署、迁移或 Agent 联合 E2E，
不能由 build/supply 0 声称 Agent READY 或生产可用。

### 同批产物实际部署与治理创建（2026-10-03）

原 `bootstrap.sh --validate-config`、`init-local.sh` 的原迁移函数、
`start-core.sh --no-build` 和三个目标服务的 `compose up --no-deps --no-build`
均实际退出 0。只替换 Core、Worker、Web、Gateway，不执行初始化重置。
迁移实际新增 `20261003100000`、`20261003130000`，原生数据库只读计数为 57。
Core 与 Worker 使用上列产物；Web 使用同一公开 checkpoint 的 98 个真实输入，
source `b6a0c1159a5d84fa8454622816638a06b5fc0d21f72112f5cf719f9e0f451df4`，
artifact `42afa40d12af5ae1d17dd7571a31375b948983e65031b6976c37effbf2b8d498`。
Gateway 原产物 `14bf9f87…` 未重新构建，重新加载私有严格 LLM listener 与持久配置。

Core healthz 200；Worker 原 `kailo-component-task` 队列启动；Web healthy。
真实管理员完成 OIDC 登录；私有模型目录匿名请求 401。管理员经原 BFF 提交
`workspace.create`，ActionExecution `0056fb6d-792d-41bf-a2ba-d1242ca853cb`
的 Temporal task 读回 `COMPLETED`，Workspace
`ad9a6443-f0a2-47d2-895d-f11b8fef9e38` 读回 `ACTIVE`。
原生 provider/model 经已认证配置 API 登记，再由 `llm_route.create`
ActionExecution `93444fce-67cf-415d-9a99-237be9c6debd` 创建受治理 Resource
`eb0d3d98-b49f-4002-b9b4-f00023ea35ab`：实际 `ACTIVE`、version 2、
native revision 1、hash `8a12148819ddde184110b2becba6678b2d33a65ad8e6e73e88c426710088c013`。
原 Gateway 集合接口读回同 ID 的 virtual model revision 1；没有直接写业务表。

原件在 `/volumes/data/kailo/tmp/codex-agent-chain-deploy-20261003.sAsJuW/`：
`live-forward.log`、`start-core.log`、`replace-three.log`、
`model-source-readback.log`、`model-route-create.log`、`route-state-readback.log`、
`route-native-collection-readback.log`。早期短 tag 不存在、查询误用表/列及单资源
GET 返回 405 均为操作失败，未写业务状态；更正为真实 full-commit tag、既有
数据库列和原集合接口后得到上述结果，不把失败记为通过。

四步结论：权威为 DD-13/70/71 与现有 Resource、Action、Workspace 生命周期；
影响仅已发布镜像、非密配置投递、原迁移和经治理创建的业务对象，不改契约；
不复制模型配置正文到 Core、不共享模型凭据、不绕过权限；重复或未知创建保留
原 ActionExecution 观察，不生成第二个请求。目录缺 RuntimeProfile 时继续关闭
Version 入口。此次没有运行 full，没有创建 Agent Installation 或实际调用模型，
未证明计量、工具、客户端设备或一期生产就绪。

## 2026-10-03 Customer 初始化与 run 登记批产物

固定公开 commit `104a9104b60d5357306cfc7528d7b8188399c536` 的干净 Data
快照执行原 `tools/release.sh core worker`，真实退出 0。Core、Worker 的镜像、
原 Syft SPDX 与 SLSA provenance 均成功产出；没有重建 Runtime、Web、Relay 或 Win。
复用 Runtime `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。

```text
core   sha256:0b4299137ebe516a99f8e05763cd106ed952ae8a08ef40817ae1c1a829a0339d
worker sha256:2cb5525cf269ab9099eaa609363e6088c14e9aa1ea2272c67aeff3d707ce947e
```

两者原 registry push 均退出 0，独立 HEAD/GET 均为 200，返回 digest 和 manifest
原始字节 SHA 与上述产物一致。Git archive、ls-tree 前后比较均 0；Git 来源为真实
Github remote，不是本地 clone。原 BuildKit 父 cgroup 为 8 CPU / 16 GiB、swap 0；
未修改 Cargo 并行或原配方。Core 配方没有显式 `CARGO_BUILD_JOBS`，不将其写作 16。

原件位于 `/volumes/data/kailo/tmp/codex-customer-core-worker-release-20261003.853u9M/`：
`release.log`、`release.exit`、两份 `*-push.*`、`*-registry-*`、
`artifact-proofs.sha256`、`source-*-before.*` / `source-*-after.*` 和资源回读。
此前输入哈希跟随 symlink 的失败保留，不作源码证明；以 Git 原生字节比较为准。
本条只证明发布产物与来源；限定部署、Customer 初始化、Agent 首 turn 与联合计量
E2E 不由 release 或 registry 200 推导。固定源码的原 full 由同一批单独留存实际结果。

### 同批部署与 Customer 重入实证

原 `start-core.sh --no-build` 与 Worker 的原 Compose 限定替换均退出 0；
部署前后容器 ID、镜像和启动时间比较只有 Core/Worker 改变。Core healthz 200，
Worker 日志确认原 Task Queue 启动。在线库已有 57 条成功迁移，
`3d8c0c11..104a9104` 的迁移目录无变化，本批不重复执行迁移。

从原 `init-local.sh` 复用 IdP subject 查找及 `bootstrap-tenant` 调用，对既有业务 Tenant
`6179e160-6055-4e9a-ae63-1793509c230c` 初始化原生计量 Customer；不直接写业务表。
首次与第二次调用均退出 0，均返回相同 Tenant、管理员与 `state=COMPLETED`。
Core binding 为 ACTIVE、version 1，customer_id 为 `01M41A96ZS6QM302QNE3EDF3YM`；
OpenMeter 原生集合与单项接口均 200，集合总数 1，key 为该 Tenant UUID。

ActionExecution `74dbc127-674e-45fa-94ce-fbb156e808ab` 为 ALLOWED/DISPATCHED，
Operation `d4e13300-34ad-4d36-8f8d-868c257dbb0a` 与幂等键均未改变。
重入后同一 Operation 下仍为六条审计事件：INTENT 一条、DECISION 一条、
派发 fence 两条、RECONCILIATION/ACTIVE 一条、DISPATCH/DISPATCHED 一条。
审计关联读取既有 `operation_id` 与 `evidence_refs`，不把未填的顶层 AE 列误判成无审计。

原件位于 `/volumes/data/kailo/tmp/codex-source-close-20261003.7MzqS1/`，SHA-256：

| 文件 | SHA-256 |
|---|---|
| `start-core.log` | `5cf4aeaaf9a07048396712a2c8c7a80e0fcd82cc2535fb3791a2b7f91536076e` |
| `start-worker.log` | `66e5df7d95496e455d35f38e84dc8166d0926e99935c99c44fe136b9a6d31be0` |
| `tenant-customer-bootstrap.log`、`tenant-customer-bootstrap-repeat.log` | `779188d123f4c9d0d134c4402610a376bf06e580910bd9f50b9a8f8500b40b78` |
| `customer-reentry-readback.log` | `187ee9239c0e2db16c589bd4c3f4b72df2c9fa6c740e1715101c32f5d5802950` |
| `native-customer-readback.log` | `5b966ce72c3b4e87a34c6dbe9ec66114bf611e58bac1d79f535691682fcc71e9` |

四步结论：权威为 DD-13 与既有租户计量接缝、AE/Operation 和原生 Customer；
影响为已发布镜像及一个既有业务 Tenant 的外部引用，schema/API/Workflow 不变；
不复制原生账本、不创建默认授权、不重放未知副作用；重复调用读取同一结果，
失败与 UNKNOWN 仍沿既有对账处理。此次不证明全部 Tenant、Quota/credit、真实用量、
普通 mention、模型推理、工具或三端设备通过，不改变任何追溯门禁状态。

### 同批完整检查的失败边界

同一次原 `tools/check.sh --full` 实际退出 1，原件为上述 `853u9M/full.log`，
SHA-256 `64f955bece49e71cfe80550126d56b21e05fc132ddc8d97cc18d066f74598fa1`。
Core/Worker 静态检查与既有验证、四侧生成与 143 个 schema 兼容、隔离库
57 条迁移前进/末条回退/再前进、SQLx 和 44 个枚举约束通过。
失败项为 Desktop 来源校验：登记值 `6243945683bd87a306e8e1194ba295f2b08d4e3b599b380bc2b229293a8eb356`
与检查树实算 `b624765fdef6a30f0935d3a8cd705e2e8088d859f10230b24dc05bd52ae4bd13` 不一致。
不手改来源摘要冒充重新构建，不把这个结果外推成当前整个工作树通过。

实际 `.env` 预检在该隔离检查中 SKIP，三项显式业务演练 ignored，未安装 gitleaks；
Win11 实机/签名与 Mobile release 签名仍未闭合。本轮追加回执走原文档快路径，
不重新编译 Core/Worker 或重跑 full；客户端来源在其独立交付批次收口。

### 2026-10-04 固定 8b Core 交付与限定容器替换

干净输入为 `8b3882d35b84b2c0d6bfcb29321c62c7a44f82d4`，包含 Runtime 恢复
锁序及 AgentTask 跨页恢复。沿原 `release.sh` 的 Core 构建/pin/Syft/provenance
步骤执行，未改发布工具、未构建 Worker/Web/Win/Gateway/Runtime。原构建 session
69355、push 与独立 manifest byte 读回 64702 均退出 0；Core artifact 为
`sha256:c970fc9d076640fbf0f0176ef13b2dbbe9e30ca757ec7e8950622d4efa6dbf54`，
复用 Runtime `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。
既有 builder 实际 8CPU/16Gi/swap0、Data 缓存；原 Core 配方未显式设置
`CARGO_BUILD_JOBS`，不能由后来定向 SDK 的 16 推导构建参数。

原件目录 `/volumes/data/kailo/tmp/codex-core-runtime-task-delivery-20261004.d2t87J/`。
同 artifact 的 SPDX SHA-256 为 `d4ea2401ef741aa88bc332f7c80f4ce182108af952dc5749e9c12d8268750457`，
provenance 为 `631e95e83fd6f495e5353de60501db0e39e1aacd9c0091a59a9e49f1ca00eb04`，
其来源提交为上述 8b；原输入 allowlist 前后 SHA 相同：
`2a047b705f4d326c5370e7e88a1a273ba6020009f1aca53778205a9b83dfba9f`。

仅私有干净 Compose 的 Core image pin 选用该 artifact。原 `start-core.sh --no-build`
session 66580 退出 0，fresh wrapping 后仅 Core 被替换，新容器
`f2d6b36e805cdfeeb5383cdfd0da64d801a27374e537b19bc2beee75ad65b52f`，
StartedAt `2026-10-04T00:21:25.204388912Z`；healthz 200、Core/原生 Codex child
存活、OOMKilled=false。唯一 `.env` 未改，SHA-256
`9542763e36156af691b6f74c2bbb3076031ac3f5f25c873cf2a8c2ce0a45be31`。
因此只证明当前运行 Core 已替换，不宣称正式默认 Compose pin 已升级，
也不保证下一次不带该私有 pin 的启动会选择此产物。

原 profiles RO 内容及 state RW 挂载保持；只读数据库前后事实一致：Installation
`8f240978-34bb-437d-97ee-498a30e67e86` 仍 ACTIVE generation 1，固定 Version
`cc099e7c-74d6-48a8-86c2-63bb878551ea`，projection hash
`118822289da62c5ccf3020ad75a06806d719b74cc8e9cc9ec3ec2505802074c7` 不变，
Invocation 0、成功迁移 57。未重发安装、Workflow 或模型 turn。
所有既有容器前后 ID/image/StartedAt 对比仅 Core 变化；另一 lane 新增自身 SDK，
故不声称全宿主容器集合不变。Gateway/Worker/Web、数字人与其他既有服务未替换。

原日志 SHA-256：`core-release.log` 为
`6cbf713fca57d3bdbfacfa012ea633c4602f3605775ac22d77d765e07f49e6cb`；
`core-registry-readback.log` 为 `9d4e148141cab261ad6516e125f530aa1e009e89b512ad21230be92b5c3fe4c2`；
`core-start.log` 为 `5cf4aeaaf9a07048396712a2c8c7a80e0fcd82cc2535fb3791a2b7f91536076e`；
`core-health-runtime.log` 为 `855470cc8028306a206c60d5165aabafef133289a898ff5e7e1dae4b05d27ca4`。
四步边界：权威为原发布步骤与已提交 Runtime/Task 消费者；影响仅固定旧源码产物
和运行 Core；副作用未改变配置秘密、数据库事实或其他服务；本批普通 `agent.invoke`
与权限/模型 SUM 结算源码尚未部署，不继承本节健康、来源或 SBOM 为新入口/业务验收。

### 2026-10-04 固定 13a8 普通 Core 交付：02:02 UTC 限定部署

干净提交 `13a8af775afb5232a5ce590bd9d5750cbb0f1a73`、源码树
`bf6ddebe2a37ca5905b8ba16529b28daa1c3853c`，沿原 `tools/release.sh` 的 clean/pin/
Core/Syft/provenance 步骤，只在内存收窄 unit 为 Core；原脚本、锁和配方未改。
session 32339 退出 0，未重建 Worker/Runtime/Gateway/Web/Win。复用既有 builder
8CPU/16Gi/swap0 与 Data 缓存；原 Core 配方无显式 Cargo jobs，不推定为 SDK16。
Core artifact 为 `sha256:bd5c5f57b34dd3e93a34ee8a924294049b9ed688aa7ead154552ecfed0054c54`，
Runtime 仍为 `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。
原 registry push 0；独立 HTTP200、manifest 原字节 SHA 与 header digest 均匹配。
输入 allowlist 前后 SHA 同为 `0b71cbe02d844a6d9cf57a16211f26521c06bb65613ea03f90521f7d1796dce7`。
原 SPDX SHA 为 `dafdbdc3350afdebbecafd8dff25f183b6c4423ef7eca0abf669a2a2a79b2039`，
provenance SHA 为 `249697420c1ab84ccf03c422893929fa01652d0ea2105544925633ea9973df79`；
subject/source/runtime 已读回，未重造证明。

原 init-local 迁移函数在固定 10ad SDK、4CPU/8Gi/swap0/UID1000 内执行；仅 forward
`20261004002000_agent_invoke_model_usage` 和 `20261004003000_agent_installation_execute`，
线上成功迁移 57→59，无 rollback/reset/夹具。原 `start-core.sh --no-build`
session 49374 退出 0；新 Core `1b9a987e6957970b4cb73375682b8c373fbbff9a43ce092bf323654ce9d99da3`
StartedAt `2026-10-04T02:02:49.594758448Z`，healthz 200、OOMKilled=false、Codex child 存活。
原 profiles RO/state RW、固定 Installation/version/generation/hash 不变；Invocation
在本 lane 部署后首次只读为 0，不重发安装或 turn。Core 阶段 Web 已是另一 lane 的
`b399d911…`；本阶段其余 23 个平台容器及 5 个既有数字人容器 ID/image/StartedAt/status
均未变。Worker/Gateway/存储/IdP/OpenBao/OpenMeter 未替换。

运维先将真实隔离验收 meter 投递 sole `.env`；本 lane 前后 env/profile SHA 相同。
持久 Core pin 与 14 条 trace artifact 引用窄补丁已交主线并选入，未操作默认 index；
运行替换不等于该元数据已提交，最终以主线实际 checkpoint 为准。02:05–02:07 原
BFF owner 审批及 uses0/maxUses1 的 ACTIVE Delegation 回读见
[Agent 记录](agent-definition.md)，不是模型首轮或业务终态。

原件 `/volumes/data/kailo/tmp/codex-agent-invoke-core-delivery-20261004.HRUiTs/`：
`core-release.log` SHA `249b803a348cacb26bccda18fb689ee17a632de981e766be2db68d12428e2b77`；
`core-proof-push.log` 为 `02aaf3cddccff2e0d8ebb89f8a5fb4620a591ea3b26318f876ab254762344922`；
`forward-migrations.log` 为 `763b1b26a3bee7e06e92981f823e0e7b490d9b5ab8d61aaa40f0c0c645bc4f3b`；
`core-start.log` 为 `a764a4d2c8435c3ec008e05e7c2b8462cdd1b8705816c53094285de681b9cf37`；
`core-health-runtime.log` 为 `d9ac559b8519c24b5ef1c679c047d924d99fc445d2ba9bc4f5c416f9c5c72d62`；
`deployment-comparison.log` 为 `387dc814b1dc71fb30e69d808138c279881f11356a35ee2604b55db82f2838b7`。

四步结论：权威为已提交普通调用、原发布/迁移/启动与 Approval/计量链；影响仅固定
源码产物、两条 online migration 和 Core 容器；副作用前原引用和受控凭据边界不变，
不改业务事实或其它服务；异常仍保留原 UNKNOWN，不重放 turn。原源码阶段 full1/
数据库 SKIP 保留，本节没有重复 full；隔离预算不等于生产计费配置，未证明真实模型、
频道回复、stored usage、Win11 安装/签名或 Mobile 设备验收。

主线元数据选定树 `d368cbb4438d7022465313a5d2f02352eaf11285`（相对 13a8
18 文件 +36/-36）的原 `./tools/check.sh seam`，session 66154 实际退出 0。
6 份来源/6 个当前源码产物通过，Win11 unsigned 和 Mobile release 签名 NOTE
保留。原件 `/volumes/data/kailo/tmp/codex-agent-invoke-delivery-stage-20261004.2nYIn8/seam.log`，
SHA `532b7b29179a81a6909e9089b06abd53a96b45bfcb207f9700da92c9d4048654`。
这是上轮 full1 唯一产物维度的定向读回，不改写原 full 结果，不称新 full0。

### 2026-10-04 固定 b282 MENTION Core：02:51 UTC 交付与拒绝边界

干净输入为 `b2829522227d7f17053228835c9fac61734a04ef`，tree
`41d61388c80614fba10e7ac46a9fe58361cd92ba`。复用原 `tools/release.sh`
clean/pin/Core/Syft/provenance 步骤，仅在内存收窄 unit 为 Core；session 28771
实际退出 0，不构建 Worker/Runtime/Gateway/Web/Win。原 builder 为 8CPU/16Gi/swap0、
Data 缓存，Core 配方未显式设置 Cargo jobs，不以 SDK16 推导构建参数。
Core artifact 为 `sha256:cae7005b2dcaecea2fbacf5edbc32421f08f61dca2b574ae3a1b92202dc0fcb4`，
复用 Runtime `sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`。
原 push 0，独立 registry HTTP200、header 与 manifest 原字节 SHA 均匹配 artifact。
Git archive 前后 SHA 同为 `bb19c184495a4282d36e5627e88428958f56219ef93a7e965ee859e40fe69a2f`，
原构建输入与固定提交的逐字比较为 0。SPDX SHA 为
`f77f17796f861665709455d6f4f5d899f79fa00e2ca52bf63a82fb18538b6bcf`；
provenance SHA 为 `e6211ae8c2c25d1ef222b53e927c2032fe55e80ad50de9edbd41dcdf90b31e81`，
subject/source/runtime 均实际读回。首次 proof 路径读取误用 `with_suffix` 退出 1，
发生在成功 push 后；保留原件，修正文件名读取后 0，没有重复构建或推送。

原 init-local 迁移函数在固定 10ad SDK、4CPU/8Gi/swap0/UID1000 内只 forward
`20261004004000_web_message_mentions`，线上成功迁移 59→60，新增 mentions 列
NOT NULL/default 读回一致。首次函数提取错误退出 127，未执行数据库动作；
原函数正确调用后 0，没有 rollback/reset、夹具或安装重放。
原 `start-core.sh --no-build` session 65219 退出 0，新 Core
`8d0efc4c1366890b75aba3e43a1c17479e196ecb4d3972bf58ec2976465d78e7`，
StartedAt `2026-10-04T02:51:01.388831144Z`；healthz 200、OOMKilled=false、
原 Codex child 存活。sole env/profile 字节前后相同，profiles RO/state RW 未变；
该阶段只有 Core ID/image/StartedAt/status 改变，其余 27 个既有平台容器不变，
不将其中非运行容器写作健康。原 Installation 仍 ACTIVE generation 1，固定
Version/hash 不变；部署后的 Invocation 0 是首次 UI 发送前的时间点，不是最终业务结论。
Core pin 与 14 条 trace digest 的 15 行独立补丁已同步并交主线选入；未操作默认 index。

首次 UI 发布的原 403/Relay 400 `restricted: not a channel member` 是合法拒绝：
固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的
`.references/buzz/crates/buzz-relay/src/handlers/ingest.rs::{ingest_event,check_channel_membership}`
与本 fork 相应消费者读取认证 `auth.pubkey()`，不是 `p` 目标；平台 governed 分支
仅认原生 roster。主线经原 BFF 明确添加 WorkspaceMembership 后，03:03:13 UTC
native 只读查询证实同 community/Workspace 下 sender `76bc7224…` 为 member，
joined_at `02:59:12.490892Z`、removed_at NULL、active count 1；本 lane 未写 Relay、
授权或业务对象，未重启或重发。主线 03:00:14 的单次消息已由 Relay 原 ID 读回。
该消息后 native turn completed，但本节不能声称 Invocation/回复/计量终态：
03:03:16/31 Core 仍明确拒绝 native usage `01a104db-1d99-7e81-9e50-e28a0baff358`
缺 Core trace，checkpoint cursor 0 留存。`gateway_usage::correlate` 只消费写前冻结的
trace/Invocation/operation，不能从共用 Gateway principal 猜关联；未弱化该 failclosed。

原件目录 `/volumes/data/kailo/tmp/codex-mention-core-delivery-20261004.pf77zn/`：

| 文件 | SHA-256 |
|---|---|
| `core-release.log` | `d1226ef4f0b720dedabf04f7c7fea1881f5c716687f62c18bd0da8350e3f2bdc` |
| `core-proof-readback.log` | `0e90497ca55b2ba2f0cfde1f4814191267c878c0125f138191b3ce627c571652` |
| `forward-migrations.log` | `f7b214023cbdc43f4366e235d3f3bc496e42e026a02b40857e159e617fd4c351` |
| `core-start.log` | `5cf4aeaaf9a07048396712a2c8c7a80e0fcd82cc2535fb3791a2b7f91536076e` |
| `deployment-comparison.log` | `9f26800370a8211c08b00e9c3859469f479feb72ad105f55abf78a2bc0145eb7` |
| `relay-membership-readonly.log` | `c69e3014a44c6d1d229e954982660f57f7969765d4db7ab270cdc7aa5e7026cb` |
| `usage-tail-rejection.log` | `3a1a08444d8af99fc555b6cff8e39f47376787f2deb905300dd2a6d3daea2b0c` |

四步结论：权威为已提交 MENTION、原发布/迁移/启动、Relay sender roster 与冻结计量归因；
影响仅该 Core 产物、一次 forward migration 和 Core 容器，Relay 拒绝无需源码改动；
副作用保留原 Installation/Workflow/业务数据与受控凭据，不扩大权限、不重放 UNKNOWN；
健康、来源和原 ID 接受不等于模型业务结算，trace 缺失、reply NULL/usage 未提交仍待原链对账。
本节没有重复 full，不证明 Win11 安装/签名、Mobile 设备或生产计费配置完备。

### 2026-10-04 固定 99dd 原生 trace Core：03:45 UTC 限定交付

干净输入 `99dd3ebba3d278ca2c373b390909d72c0a4d5cbd`，tree
`7cc70711ee8281ce580227d5182b4c3daf6eef95`。原 `tools/release.sh` 在内存仅收窄
unit 为 Core，其 clean/archive、Runtime pin、原 Core 配方、Syft 与 provenance 均保留；
session 22942 退出 0。原 builder 8CPU/16Gi/swap0、Data 缓存及 Cargo 配方未改，
不把 SDK 的 jobs=16 推导为构建实参。Runtime 复用
`sha256:ad13c952e20c134c70cc4ba0293e2d568aa98641fe16ede4cceb2671d10887ec`，
Worker/Gateway/Web/Win 均未构建。Core artifact 为
`sha256:50bd7f19299544399da452481be06ff312dd11c486ccaff8edbbe691cccafd16`；
原 push 0，独立 registry HTTP200，header 与 manifest 原字节 SHA 均等于 artifact。
构建输入 archive 前后 SHA 同为
`96273c28d1dd36dcd95063c854a04d92b4457df944d03cf9435a4f027e0acce7`，逐字源核对 0。
SPDX SHA `a6fbd7ff6a09577990db2322975ecaf7f0cd9a5256381193367d0275cfba5548`、
provenance SHA `78c3114d6676c609221e51374731799756e5f413a14ade4bbf420b79074b33d4`；
subject/source/Runtime 实际核验 0，两份原 proof 已逐字交付正式 ignored `dist/`，cmp 0。

03:41:47 只读部署前核验 active/unconfirmed native turn 为 0；旧 Invocation 原生
completed，不是业务成功。原 `start-core.sh --no-build` session 71353 退出 0，
新容器 `b532c724acb3ffab66961dcd678ad767cc43644b976b45ebb8cf4ae3c6f3fd29`，
StartedAt `2026-10-04T03:45:34.719770259Z`；healthz HTTP200、OOMKilled=false，
仅 Core ID/image/StartedAt 改变，其余 27 个既有平台容器完整比较不变。
没有新迁移，线上成功迁移仍 60；sole `.env` 与 profiles 前后 SHA/cmp 均不变。
原 Supervisor 恢复唯一 Codex child；`agent_runtime::Supervisor::ensure` 只有原生
initialize/config/read 全部 guard 通过后才保存 process，失败由 kill_on_drop 关闭。
本次不另开生产 RPC 或第二进程；同 Installation ACTIVE、generation 1、resourceVersion 3
与 config hash `118822289da62c5ccf3020ad75a06806d719b74cc8e9cc9ec3ec2505802074c7`
保持不变。仅辅助读取原配置的 OTel 字段：trace endpoint 为原 collector `/v1/traces`、
binary，logs/metrics exporter 为 none、prompt=false；磁盘读取不冒充独立 native 回读。
主线原 browser read 03:47:04 退出 0，旧 Task 仍 RUNNING/BILLING_UNAVAILABLE，
source 1/reply 0，Delegation EXPIRED version 2/uses 1；未续预算、改权限或重发旧回合。

原件目录 `/volumes/data/kailo/tmp/codex-native-trace-core-delivery-20261004.7a3Hd1/`：

| 文件 | SHA-256 |
|---|---|
| `core-release.log` | `b80877b8636caca2dfa4ac0bdb1d2483eb54f8f659b74b48fa1d6b3aa5e2ebd0` |
| `core-proof-readback.log` | `63678ded80ec73de82c66c8c9f863f818afac700626a394b34472d465c936870` |
| `core-start.log` | `5cf4aeaaf9a07048396712a2c8c7a80e0fcd82cc2535fb3791a2b7f91536076e` |
| `core-health.log` | `279563bb5e00563f197cd3fcf8e247f57aad3eeda2c301ea89906d3a1623d33d` |
| `native-config-selected.log` | `19543b3b766b5795f052f97fc5a3bf941633ea58a5fcc4698ea7313e2475d043` |
| `bff-after-core-read.log` | `2edb5ebc7f84af2d4b6fc91de11f9f424fd2e0e999752d0e5ebf1f16e52479cf` |

四步结论：权威是固定提交、原 Core 发布/启动链与强制 config/read guard；影响仅 Core
产物、15 个持久 pin/trace digest 值及一次 Core 替换；副作用未改变 DB 业务事实、
profile/秘密配置、权限、预算或其它容器；本次健康/配置恢复不证明新模型调用、旧无 trace
用量修复、回复或计量终态，不重复 full，不扩大 Win11/Mobile 设备验收结论。
