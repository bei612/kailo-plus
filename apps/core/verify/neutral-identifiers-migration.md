# ADR-17 中性内部标识：本地拓扑迁移核验（2026-09-29）

按 `docs/adr/ADR-17-neutral-internal-identifiers.md` 的迁移步骤，在不 `--fresh` 的本地拓扑上执行。

## 迁移过程与结果

1. 迁移前在途角色动作计数为 0（`tenant.admin.*`、`workspace.admin.*`、`tenant.bootstrap` 处于
   `EVALUATING`/`WAITING` 或已允许未派发）。
2. 以旧项目名 `down`（保留卷），把 6 个命名卷复制到 `platform-local_*`，源与目标 `du` 大小一致
   （差异仅为块取整）。旧项目另有一个无服务引用的孤儿卷 `kailo-local_openbao-data`（OpenBao 早已改为
   挂载 `data/secret-store`），验证通过后与 6 个旧卷一并删除。
3. OpenBao raft：写入 `data/secret-store/raft/peers.json`（属主 100:1000）后以新 `node_id` 启动，成员
   恢复成功（文件被消费），解封后 `secret-store-init.sh` 写入新策略与角色。
4. 本地密钥文件改名；`.env` 的 Mobile 回调改为 `…:/platform/oauth2redirect`；`bootstrap.sh
   --sync-client-redirects` 收敛浏览器与原生客户端回调并回读一致；`--ensure-service-audience` 已一致。
5. 迁移 `20260929120000` 应用成功；新 Core、Worker 启动。
6. 删除旧 OpenBao 对象：platform 的 `kailo-core`/`kailo-verify` 角色与 `kailo-core` 策略、root 的
   `kailo-core-audit` 角色与策略、tenants 的 `kailo-tenant-provisioner` 策略；删除前核对两个
   provisioner 角色已挂 `platform-tenant-provisioner`。provisioner 角色名来自 `.env`，按 ADR-17 保留。

## 迁移中发现并修正的缺陷

- **Tenant 子 namespace 的 Core AppRole 绑定旧网段**：`secret_id_bound_cidrs`/`token_bound_cidrs` 在创建时
  取 `OPENBAO_TENANT_CORE_BOUND_CIDRS`；项目改名后 app 网络子网变为 `172.25.0.0/16`，已有 Tenant 的角色仍
  绑旧网段，Core 日志反复出现“取 CONTROL 私钥失败：AppRole 登录失败”。只有少数业务流程会调用
  `ensure_tenant` 重写角色，读取私钥的路径不会。修正：Core 启动时在服务前对每个未删除 Tenant 调用
  `ensure_tenant`（幂等写入并回读），失败的 Tenant 记错误日志与 `platform.secret_store.tenant_converge_failed`
  度量，其取用保持拒绝。结果：`tenants=4, failures=0`，CONTROL 私钥告警消失。
  破坏核验：以 root 令牌把 Tenant `1df0889c…` 的角色网段改为 `10.99.0.0/16`，重启 Core 后回读恢复为
  `172.25.0.0/16`。
- **回调同步按列表比较**：Keycloak 把回调当集合保存，返回顺序与导入顺序不同，原生客户端回读误报不一致；
  改为集合比较。门禁规则同步改名，破坏核验：把 `init-local.sh` 的调用改回旧名，`check.sh security` 报
  “客户端回调同步必须在 IdP 就绪后、Core 启动前执行”。
- **回放测试遇错即停**：`TestComponentTaskReplay`/`TestApprovalReplay` 以 `t.Fatalf` 终止于第一份失败，
  掩盖其后夹具；改为逐份 `t.Errorf`。

## 验证

- `core/verify/run-integration.sh` 退出 0，31 批 `test result: ok`；`web-walkthrough.sh` 20/20。
- 新录 6 份 `platform:` 前缀 history（Tenant 暂停/恢复、Workspace 暂停/恢复、成员开通、审批）加入回放；
  破坏核验（在 `task.begin` 插入 `workflow.Sleep`）使 19 份组件任务夹具失败、含全部 5 份新录组件任务
  history，还原后通过。基线 Workflow `PLATFORM_BASELINE` 尚无新执行，旧基线夹具与 `legacyBaselineKind`
  按 ADR-17 保留到窗口关闭。
- Web 客户端 `sha256:6fbd6c35…`、Desktop `.deb` `sha256:3b43222a…`（包名由 `PLATFORM_DISPLAY_NAME` 注入）
  从当前源码重建并写回。
