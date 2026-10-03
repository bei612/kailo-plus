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
