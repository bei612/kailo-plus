# 原生页面入口经平台模型路由调用模型与问数验收数据源证据

本记录对应 DD-128、DD-129（design-authority `53748bf0b88e99e83b68c49bbd7630f8c81661f0`）
与 V-SCN-172/173/174 的源码与隔离验证，不代表线上 release 已登记、binding 已激活、
key 已投递或问数已在生产完成。

## 实现与影响

- 入口 release 的 `allowedModelCallModes` 可为 `{NONE, PLATFORM_LLM_ROUTE}` 的非空子集；
  `SELF_MANAGED_MODEL` 仍拒绝（`component_release.rs::native_page`）。
- binding 选定 `PLATFORM_LLM_ROUTE` 时沿原 COMPONENT_BINDING 的 `provision`：没有
  adapter 目录，reader 由 binding 身份派生为 `application-model-<binding hex>`，冻结
  `deliveryMode=NATIVE_PAGE`、空挑战；激活回执是 Core 以该 key 的模型发现与原生 key
  id/revision（`application_model_route.rs::native_page_receipt`）。调用准入与 usage
  归因对入口 binding 忽略服务自带 `traceparent`，一律 `BINDING` 归属
  （`admit`、`gateway_usage.rs::application_correlation`）。
- 迁移 `20261021010000_native_page_model_route` 只替换投递守卫函数：入口 release 只接受
  与冻结 projection、原生 key 列逐字相等的回执对象；带 adapter 的 release 条件不变。
  回退在存在入口模型事实时拒绝（23514）。
- 运维投递 `deploy/components/native-model-delivery.py`（经 `bootstrap.sh
  --native-model-delivery`）：只读导出冻结 projection（只读事务）、建立只读该 KV 路径的
  policy 与一次性 AppRole、OpenBao Agent 渲染、写入组件专属 env、停用后退役 reader；
  不创建 binding、route、Gateway key 或 KV 值，不打印 key。
- 问数验收数据源：`data-query/docker/sample-datasource.yaml` 与固定零售数据、
  `wren_reader` 只读角色、`sample-datasource-verify.sh` 核验脚本。
- contracts 未变（不需要 `tools/gen.sh`）；不改上游 artifact 输入，只需重建 Core。

## 验证结果（2026-10-20，CI 节点，分支提交）

分支提交不能进入 `kailo-ci check-step`（只接受 main 可达提交），以下在 CI 节点用同一
检查镜像 `local/kailo-check:<tools/check.Dockerfile sha256>` 与一次性 tmpfs PostgreSQL
执行，日志 `/volumes/data/kailo/ci/tmp/wren-model-db.log`（sha256
`2e1b189f8d2db9ccbeb43dd558d6481c8294fee8b572c5852c7f7cb001b1fddd`），提交
`d9b700ddbfd8f824de41e268cb49bf35a234b237`：

- `sqlx migrate run` → `revert`（本迁移 down）→ `run` 全部成功；
- `cargo clippy --all-targets -- -D warnings` 退出 0；
- platform-core 定向测试 18 passed、0 failed（含 `native_page_entry_routes_models_without_category_adapter_or_native_proof`、
  `native_page_release_needs_no_connector_or_capability`、`gateway_usage` 全部）；
- 隔离库测试（`--ignored`，载入 `application-execution-base.sql`）2 passed：
  `native_page_projection_activates_only_with_its_own_discovery_receipt`（外来 reader、
  多余字段、错 key revision、adapter 形回执均 23514，正确回执激活后不可改写，回退被拒）与
  原 `original_projection_refuses_unproved_model_activation_and_drain`（adapter 路径不变）。

运维投递单元测试 `python3 -I deploy/components/test_native_model_delivery.py`：6 passed
（提交 `79b7e0dd`），覆盖 projection 精确形态、导出只认 ACTIVE 入口 binding 且只读事务、
policy 只读精确路径且同名不同内容拒绝覆盖、Wren `config.yaml` 必须恰为冻结模型集合且
`api_base` 为 Gateway、物化只写同名 key 并删除渲染副本、无关 env 拒绝覆盖、退役删除 reader。

示例库（提交 `79b7e0dd` 的 init 文件，平台同一 PostgreSQL 16.15 digest，`--network none`
一次性容器）：初始化写入 5/18/40/3000/36000/90120 行；两次独立初始化的订单校验和相同
（`ee360cc8aa15b8fb7c6acb5c8128ce9e`）。`sample-datasource-verify.sh` 退出 0：六表只读查询
通过；默认只读下 INSERT/UPDATE/DELETE/CREATE 被拒；`begin read write` 后 INSERT、UPDATE、
TRUNCATE 均为 `permission denied`；读写事务内建表与临时表另行实测为 `permission denied for
schema public` 与 `permission denied to create temporary tables`；角色无超级用户等属性。

## 未覆盖

生产 Core 的 Gateway key 登记、ExtAuthz 回调、OpenBao 写入与审计、真实 usage 入账、
Wren 原生向导连接与真实问数、WeKnora 原生模型凭据接口的投递，均未在本记录中执行。
