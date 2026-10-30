# DD-168(5)：组件凭据托管（验证记录）

设计依据：`.design/07` §4.8.11 组件凭据托管合同、`03` ComponentSecret 实体、`02` DD-168(5)(7)、`16`
V-SCN-305–308（V-SCN-307 为本服务的反证）。能力记录：`tools/traceability/component.secret_custody.yaml`。

## 源码范围（平台）

- Core 服务监听面（`component_secret.rs`，路由在 `service_api.rs`），调用身份与前提同组件通知
  （`component_directory::authorize`：binding 目录 client 令牌，binding 与 active generation `ACTIVE`，
  release `APPROVED`、`NATIVE_PAGE`，Tenant/Workspace `ACTIVE`），另要求 `KAILO_EMBED`：
  - `POST /service/v1/component-secrets/bindings/{binding}/secrets`：请求体
    `{purpose:"DATA_SOURCE_CONNECTION", actor:{issuer,subject}, value:{<key>:<string>}}`，未知字段整体拒绝；
    键 `[A-Za-z0-9_]{1,64}`、1–64 个，规范 JSON ≤ 64 KiB。发起人须为目录范围内 ACTIVE HUMAN，
    FullyConsistent 检查 binding 范围的 `manage`（Workspace binding 另查 `discover`）。每 binding 至多
    200 个 `ACTIVE`。以 CAS=0 写入 `tenants/<tenant>` 下 `component-secret/<binding>/<secret>`（版本恒为 1），
    登记 `catalog.component_secret` 并写 `OUTCOME` AuditEvent 后回 `201 {secretId, version, createdAt}`；
    登记失败时销毁已写版本。
  - `POST .../secrets/{secret}/read`：只读本 binding 的 `ACTIVE` 记录，经 audited read 并核对 OpenBao
    audit device 记录后回 `200 {secretId, version, value}`；读取期间被撤销则 `404`。
  - `POST .../secrets/{secret}/retire`：请求体 `{actor}`，规则同写入；先销毁 OpenBao 版本再转 `RETIRED`
    并写 AuditEvent；重复撤销回同一结果。
  - 回应一律 `Cache-Control: no-store`；`400` 形状、`403` 身份/前提/权限（不区分原因）、`404`
    未知/已撤销/他 binding、`409` 数量上限、`503` OpenBao/SpiceDB/数据库不可用。
- 审计：`action_key` 为 `component_secret.write` / `component_secret.retire`（非目录动作，与网关探测
  先例相同，`operation_id` 取 secret id），evidence 只有 binding ID，`parameter_hash` 只覆盖用途与键名；
  值、locator 与键名本身不进入审计、日志、错误与回应（读取回应除外）。
- secret-store：`retire_component_secret` 只销毁 `component-secret/<uuid>/<uuid>` 形状的 version 1；Tenant
  KV 策略新增 `destroy/component-secret/*`（Core 启动时按 Tenant 收敛）。
- 迁移 `20261103010000_component_secret`；Tenant 删除把 `ACTIVE` 记录转 `RETIRED`（值随 namespace 销毁）。

不新增 ResourceType、动作键、Workflow kind、SpiceDB 关系或 meter。
