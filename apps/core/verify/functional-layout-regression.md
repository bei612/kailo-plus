# 功能目录重构后的全量回归（2026-09-29）

对应 ADR-16 的目录与包名重构（提交 `076681d`，`apps/` 树与其后的 `dae9abd` 相同，
`git diff --quiet 076681d dae9abd -- apps` 退出 0）。本记录只证明重构没有改变已验证的行为，
不代替任何 Stage 的验收，也不证明 Desktop/Mobile 安装包。

## 执行与结果（本地拓扑）

- `core/verify/run-integration.sh`：退出 0，31 批 `test result: ok`。重构后的第一次运行失败于测试夹具中
  仍写着 Core 的旧二进制名；把夹具改为 `platform-core` 后重跑得到上述结果（提交 `076681d` 说明：
  「A stale binary name in the integration harness was fixed」）。
- `core/verify/web-walkthrough.sh`：20/20 通过。
- `tools/check.sh --full`：在隔离数据库上退出 0（含实际迁移前进/回退演练）。

## 破坏核验：派发结果记录

`ccb0a36` 把派发结果统一由 `governance.rs::record_dispatch` 记录（直接启动的路径经
`record_direct_launch`），迁移 `20260929110000_dispatch_state_backfill` 回填存量行；
`core/crates/platform-core/tests/native_client.rs` 断言设备公钥登记后 ActionExecution 的
`dispatchState` 为 `DISPATCHED`。

重构后把 `record_direct_launch` 的判断反转并重建 Core，该用例在
「登记完成后派发状态仍未推进」处失败（`left: NOT_DISPATCHED`，`right: DISPATCHED`）；
源码还原、重建后全套集成 31 批通过。原生端设备登记任务此前显示的
「Allowed, not started yet」由此闭合（`collaboration/fork/verify/desktop-client.md`、
`mobile-client.md` 中的观察早于该修复）。

## 门禁拦截

批量替换产品名字符串时误改了 `model-gateway` 上游 UI 的两个文件（`ui/src/pages/RawConfig.tsx`、`ui/src/configMonaco.ts`：其中上游原有的 `agentgateway-config.yaml` 字样被替换）；`tools/check.sh seam` 因
`model-gateway` 产物的 `source_digest` 与当前源码不符而失败。两个文件从 `ccb0a36` 原样恢复后
`seam` 通过，产物摘要与登记一致。

## 运行时数据迁移

运行时数据目录改名为 `deploy/local/data/secret-store`（原 `openbao`）与
`deploy/local/data/collab-objects`（原 `buzz-objects`）之前，停服并备份到
`/volumes/data/kailo/backup-rename-202609290706/`（`openbao.tar`、`buzz-objects.tar`、
`keycloak-import`）。迁移后 OpenBao 解封，Compose 服务全部恢复，随后执行上述回归。

## 未被本记录证明的边界

- 未在重构后重跑 Desktop `.deb` 与 Mobile APK 的端到端；
- 未对新 Core/Worker digest 做回滚演练；
- ADR-17 的内部标识迁移不在本次范围内。
