# Core/Worker 发布产物核验（2026-09-26）

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

## 未被本记录证明的边界

本地镜像尚未作为 OCI referrer 连同 SBOM/provenance 推送到共享 registry，
也没有远端签名及部署前验签；这按 `ADR-06` 在出现共享 registry 时启用。
本记录不证明 Desktop/Mobile 的安装包供应链，也不代替 Stage 2 业务门禁。
