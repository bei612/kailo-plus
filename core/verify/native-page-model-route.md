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

## WeKnora 消费面（DD-128(5)、SF-WEK-17，design-authority `c1e3f28b67c7c9b6ebe0ec96e27ec1aaa7286f7b`）

- 决定：WeKnora 的模型是其数据库行，但原生模型管理 API 只写调用者工作空间的非内置行、只认用户
  会话或工作空间 API key，而每个首次 OIDC 登录者默认各得个人工作空间；实例级的原生路径是上游
  `builtin_models.yaml` 加载器（启动时以进程环境展开 `${NAME}`，自身写入并以 `SYSTEM_AES_KEY`
  加密内置行，对全部工作空间可见）。因此与 Wren 同一投递：key 写入组件专属 0600 env，原生声明按
  变量名引用；不调用原生模型 API，不写 WeKnora 数据库。
- `native-model-delivery.py`：`CONSUMERS` 为每个组件登记投递目录、组件 env 与原生声明三个 env 名，
  `deliver` 是唯一物化；`materialize-weknora` 的声明核对：恰为冻结模型集合、`base_url` 为 Gateway
  入口、provider `openai`/`generic`、无 header/extra config/云凭据、Embedding 有实测维度、每条恰一个
  独占一行的 `api_key: "${KAILO_MODEL_...}"`，文件其他位置（含注释、描述）不得出现引用；声明可
  0644（非 secret，容器内非 root 进程读取），不得被他人写。
- `bootstrap.sh --native-model-delivery materialize-weknora <native.env>`：只取三个键，不 source
  Compose env 文件。`knowledge/fork/deploy/compose.native-model.yaml` 由 `start.sh` 在 Gateway 传输
  叠加之后加入（两个文件须同时给出）；`native_entrypoint.py` 在无 Gateway 传输、声明缺失或非普通
  文件、引用非 `KAILO_MODEL_*`、值缺失或为空时拒绝启动（上游加载器会把字面量当 key、缺文件则跳过）。
- 声明不手填：与 Wren `config.yaml` 同一渲染器 `deploy/components/native-config.py`（spec `knowledge`），
  模板 `deploy/components/knowledge-builtin-models.template.yaml`，事实取 knowledge `native.env` 的
  `KNOWLEDGE_MODEL_CHAT_ID`、`KNOWLEDGE_MODEL_EMBEDDING_ID`、`KNOWLEDGE_MODEL_EMBEDDING_DIM`、
  `KNOWLEDGE_MODEL_API_KEY_NAME`（按字面读取，不 source）与平台 `.env` 的
  `AGENTGATEWAY_MODEL_BASE_URL`；缺值拒绝、不回退默认，内容相同不写，变化时备份后原子替换并只列键名。
  渲染结果先经 `weknora_models`——`materialize-weknora` 对部署文件执行的同一函数——核对（有投递目录时
  须等于冻结集合）才发布，0644 发布在 owner-only 目录内。`component-deploy.sh knowledge` 在镜像、备份与
  Compose 之前（含 `--check`）只读 `check`，数据库备份后、首次 compose up 前 `apply`。
  `knowledge.env.template` 新增投递三键与四个事实键。
- 影响：`knowledge-service` 的输入含 `knowledge/fork/deploy`，source_digest 随之变化，发布须重建；
  上游源码树未改（`upstream_manifest.py diff` 不变）；无 schema/API/Workflow 变化，Wren 物化不变。

验证（2026-10-20，CI 节点，分支提交 `ac7061b993dd219562542d94eaa08baa37709cbe` 的 GitHub 取码，
日志 `/volumes/data/kailo/ci/tmp/weknora-model-*.log`）：

- `python3 -I -m unittest discover -s deploy/components -p test_native_model_delivery.py`：16 passed，
  新增 WeKnora 声明正反例（注释/描述中的引用、未加引号、字面量 key、进程变量名、provider header、
  厂商 client、重复 id、本地模型、多文档、组可写、直连提供方、非冻结模型、猜测维度均拒绝）、
  Wren/WeKnora 共用 `main` 物化、`bootstrap.sh` 端到端物化（Compose env 不被 source）与入口
  变量名规则一致；
- `knowledge/fork/deploy` 下 `python3 -m unittest test_native_entrypoint`：36 passed（新增入口拒绝
  未解析引用、`start.sh` 叠加条件与 overlay 形态）；
- 检查镜像内 `tools/check.sh lint`、`docs` 退出 0；`trace` 在接入发布证明目录后退出 0。`supply`
  在浅克隆中取不到上游基准与历史 release.sh 而失败，属取码形态，不作结论。

渲染器补充后（分支提交 `37165c0d4abf2203c59d4c8b671afaab0e325a0b`，CI 节点 GitHub 取码）：
`python3 -I -B -m unittest discover -s deploy/components -p "test_native_*.py"` 35 passed（投递 16、
渲染 19，其中新增 WeKnora 渲染 7 项：发布 0644 且通过 `materialize-weknora` 同一核对、模板占位符恰为
声明事实、缺失或畸形事实与平台地址缺失拒绝且不写、冻结集合不符拒绝、相同内容不写与变化时备份并只列
键名、目标目录与文件权限、部署入口顺序）；`knowledge/fork/deploy` 下 `test_native_entrypoint` 36 passed。

## 未覆盖

生产 Core 的 Gateway key 登记、ExtAuthz 回调、OpenBao 写入与审计、真实 usage 入账、
Wren 原生向导连接与真实问数、WeKnora 以内置模型声明的生产投递与真实知识库问答，均未在本记录中执行。
