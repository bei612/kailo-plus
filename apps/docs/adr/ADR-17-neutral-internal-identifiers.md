# ADR-17：内部标识去掉产品名——中性固定前缀加一次性兼容窗口

- 状态：已接受（设计变更先行：`.design/02` DD-111 与 SS-AGW-OIDC、`03`、`04`、`06` §3 与 §3.1、`07`、`09`、`12`、`16`、`18`、`19` 已改为中性名）
- 日期：2026-09-29
- 决策者：Kailo 实施工程负责人

## 背景

用户判据：产品名 Kailo 是部署配置，不是代码结构。ADR-16 已把 `apps` 的目录、包名与产物名改为功能命名，`DD-111`
把界面显示名改为部署配置下发。剩下的是**已持久化或跨进程约定**、带产品名的内部标识。2026-09-29 按当前工作树统计：

| 类别 | 现值 | 影响面（统计） | 持久化位置 |
|---|---|---|---|
| Workflow ID 前缀 | `kailo:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>` | 约 40 个源码、测试与 replay 夹具文件；`.design/06` §3.1 固定格式 | `projection.workflow_ref` 主键（存量 WorkflowRef）、Temporal 中运行与已完成的 Workflow、replay history 夹具 |
| Temporal Search Attribute | `KailoTenantId`、`KailoWorkspaceId`、`KailoWorkflowKind` | Core 写入其中两个（`platform-core` 的 `temporal.rs`），compose 初始化注册三个；`.design/06`、RB-04、RB-10 按名查询 | Temporal namespace 的 SA 注册与每条 Workflow 的 visibility 记录 |
| 身份 header | `x-kailo-oidc-issuer`、`x-kailo-oidc-subject`、`x-kailo-client-surface` 等七个名字 | Gateway 配置 17 处，Core、Web、Desktop、Mobile 共 8 个文件；`.design/02`、`.design/09` 的接缝定义 | 不持久化，但是 Gateway 与 BFF 之间的安全约定：外来同名 header 必须清理 |
| 指标名 | `kailo.*`（27 个） | Core 与 Worker；runbook 与告警按名引用 | 观测后端的时间序列 |
| 派生 ID 的名字空间 | `urn:kailo:role:…`、`urn:kailo:role-reconcile:…`（UUID v5 输入） | 2 处 | 派生出的 target ID 参与 `action_execution_one_pending_per_target`，reconcile 的 operation ID 写入审计 |
| 对外协议面 | Adapter Protocol 路径 `/kailo-adapter/v1/<operation>`、组件宿主属性 `data-kailo-component`、Desktop 编辑器窗口 label 前缀 `kailo-editor-`、记忆 source key `kailo.agent-memory.core`、用量 CloudEvent source `urn:kailo:core:usage` | ADR-12、`.design/02`/`03`/`04`/`07`/`12`/`18`/`19` | 尚无第三方实现与生产数据 |
| 进程内命令与部署对象名 | Desktop Tauri 命令 `kailo_*`（8 个）、环境变量 `KAILO_*`、OpenBao 角色 `kailo-core`/`kailo-core-audit`/`kailo-tenant-provisioner`、IdP realm 与 client 默认名、Compose 项目 `kailo-local` | 脚本、测试与本地部署 | 本地 IdP 与 OpenBao 的持久卷 |

数据库 schema 名（`catalog`、`admission`、`projection`、`identity` 等）已是中性名，不在范围内。

当前没有生产部署，也没有第三方 Adapter 或组件实现；存量只有本地拓扑 `kailo-local` 的数据与仓库内的 replay 夹具。
这些标识一旦进入生产与第三方实现，改名就要跨版本兼容，代价只增不减。

## 候选方案

- **维持现状，把它们定义为协议常量而非品牌**：零迁移成本；但产品名会永久写进第三方要实现的协议（Adapter 路径、组件属性）
  与生产数据主键，与判据冲突，且以后改名时代价最高。
- **中性固定前缀，加一次性兼容窗口**：趁没有生产数据与第三方实现时改掉；对确实有存量的类别（WorkflowRef、SA、派生 ID）
  设一次性窗口，窗口结束后只剩新名。采用。

## 决策

1. **中性前缀固定为 `platform`**，是协议常量，不随部署配置变化（显示名随配置，标识不随配置，二者分离）：
   workflow ID 为 `platform:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>`；SA 为 `PlatformTenantId`、
   `PlatformWorkspaceId`、`PlatformWorkflowKind`；header 为 `x-platform-*`；指标为 `platform.*`；派生名字空间为
   `urn:platform:*`；Adapter Protocol 路径为 `/platform-adapter/v1/<operation>`；组件属性为 `data-platform-*`；编辑器窗口
   label 前缀为 `platform-editor-`；记忆 source key 为 `platform.agent-memory.core`；CloudEvent source 为
   `urn:platform:core:usage`；Tauri 命令为 `platform_*`；环境变量为 `PLATFORM_*`。
2. **设计先行**：接受本 ADR 前，先修改 `.design` 中固定这些名字的段落（`02` 的相关 SS/DD 行、`03` 的 usage 映射、`04`、
   `06` §3.1 与 SA 清单、`07` 组件宿主属性、`09` header 清洗、`12`、`16`、`18`、`19`），再同步 apps 文档与 ADR-12。
3. **一次性兼容窗口**，只对有存量的类别：
   - Workflow ID：新 Start 只用新前缀；窗口内 Core 解析与对账同时接受新旧前缀，旧前缀的 WorkflowRef 按原 ID 继续对账到终态，
     不改写主键；
   - SA：先注册三个新 SA，新 Start 只写新 SA；窗口内按 SA 列举（对账回填、RB-04、RB-10）同时查询新旧两组；
   - Replay：已录制的 history 夹具保留（workflow ID 与 Core 写入的 SA 不是 Workflow 命令，不影响确定性），新录制的夹具使用
     新前缀；
   - 派生 ID：切换在没有在途角色动作与待处理 reconcile 时执行，切换前由检查确认两者为空；
   - Header：Gateway 只投影 `x-platform-*`，对外来的 `x-kailo-*` 与 `x-platform-*` 一律清理；旧名的清理规则永久保留（清理
     无代价，删掉反而重开伪造入口）；
   - 窗口结束条件：旧前缀 WorkflowRef 全部终态且超过 Temporal retention、按旧 SA 查询无结果。结束后删除旧前缀解析与旧 SA
     查询分支，旧 SA 注册留在 namespace 中不再写入。
4. **无存量的类别直接改名**：指标、对外协议面、Tauri 命令、环境变量与部署对象默认名随同一批改动切换，不设窗口；告警与
   runbook 同批更新。本地拓扑的 IdP、OpenBao 持久卷按 `--fresh` 重建，或按 runbook 迁移角色与 realm。
5. **以后新增的内部标识**一律使用 `platform` 前缀，不含产品名。

## 后果

正面：产品名只存在于部署配置；第三方实现的协议与生产主键从第一天起不带品牌；改名发生在代价最低的时点。

负面：一次跨 `.design`、Core、Worker、三端、Gateway 配置、compose 与 runbook 的改动；窗口期内对账与列举要维护双分支；
本地环境需要重建或迁移；replay 夹具新旧前缀并存到旧夹具淘汰。

## 替换边界

只涉及标识常量、对账与列举的前缀分支、Gateway header 规则与本地部署初始化；`WorkflowRef` 表结构、Workflow 代码与
Search Attribute 的类型不变。

## 重新评估条件

- 本 ADR 被接受前出现生产部署或第三方 Adapter/组件实现：存量与外部依赖出现，改为按版本协商的长期兼容方案，或维持现状；
- 设计变更评审认定某类标识是对外公开协议的一部分、改名需要协议版本号（例如 Adapter Protocol 升为 v2）：该类别按协议
  版本规则处理，不走本 ADR 的窗口；
- Temporal 的 SA 注册或 visibility 后端不支持新旧 SA 并存查询：改为窗口内只写新 SA、旧 Workflow 仅按 WorkflowRef 对账。

## 实施（2026-09-29）

标识常量只在一处定义，其余引用它：workflow ID 前缀为 Core 的 `component_task::WORKFLOW_ID_PREFIX`（拆分只经
`split_workflow_id`）与 Worker 的 `workflows.WorkflowID`；SA 为 Core 的 `temporal::SA_TENANT`/`SA_KIND`；身份 header 为
Core 的 `bff::HEADER_*`、`native::HEADER_CLIENT_SURFACE` 与网关配置，由 `tools/check.sh security` 逐条核对；派生名字空间为
`roles::target_id` 与 `role_reconcile` 的 `urn:platform:*`。未落地的对外协议面（Adapter 路径、组件属性、编辑器窗口
label、记忆 source key、用量 CloudEvent source）只存在于设计与 ADR-12，随设计改名，实现时直接使用新名。

范围内另有几项同类标识一并改名（无存量或随部署迁移）：Tauri 命令 `platform_*` 与 `PLATFORM_NOT_SIGNED_IN`、原生端本机
存储键（Desktop 配置文件 `platform.json` 与刷新令牌键、Mobile 的 `platform.config.v1`、设备私钥与刷新令牌键——本机旧值不迁移，
升级后重新填写服务器并登录）、Mobile 登录回调 `xyz.block.buzz.mobile:/platform/oauth2redirect`、Core 与 Worker 的
OTel 服务名与 Temporal identity（`platform-core`、`platform-worker`）、Worker 二进制名、基线 Workflow 类型名
`PLATFORM_BASELINE`、部署引导 ServicePrincipal 的 audience（迁移 `20260929120000_neutral_internal_identifiers` 就地改写，
principal ID 不变，审计归因不断）、容器用户与 Codex 固定配置路径 `/usr/share/platform/codex`、`release.sh` 的镜像名与
provenance buildType（`check.sh supply` 按产物所记 commit 上的 `release.sh` 核对，旧产物如实保留旧名）、本地密钥文件名
`core_client_secret`/`worker_client_secret`。Compose 服务名不在范围内，不变；`.env` 中的取值（realm、client ID、Tenant
子 namespace 的角色名、task queue 等）是部署配置，不由本 ADR 改写。

兼容窗口的执行点：

- Workflow ID：`split_workflow_id` 接受新旧两个前缀，`task_rerun` 与 `server_keys` 经它解析；新 Start 只经
  `workflow_id` 生成新前缀。
- SA：本地 namespace 初始化（`compose.yaml` 的 `temporal-namespace`）登记新旧六个 Keyword，新 Start 只写新名；按 SA
  列举的只有 `core/verify/drill-dr.sh` 与 RB-04、RB-10，均以 `OR` 同查两组。Core 不按 SA 列举。
- 派生 ID：迁移 `20260929120000` 在仍有在途角色动作（`tenant.admin.*`、`workspace.admin.*`、`tenant.bootstrap` 处于
  `EVALUATING`/`WAITING`，或已允许未派发）时失败，部署停在旧版本；role reconcile 的 operation ID 每轮现算、不落盘，
  停机切换即无在途。
- Replay：旧夹具原样保留；基线 history 录于改名之前，重放以原类型名 `KAILO_BASELINE` 注册（仅在重放测试中）。
- Header：两个网关入口都移除七个旧名 `x-kailo-*`，`check.sh security` 核对，永久保留。

窗口关闭的判定（两项都为 0）：

```sql
select count(*) from projection.workflow_ref
 where workflow_id like 'kailo:%' and projection_state <> 'TERMINAL';
```

```text
temporal workflow count --namespace <ns> --query "KailoTenantId IS NOT NULL OR KailoWorkflowKind IS NOT NULL"
```

第二项为 0 说明旧前缀的 execution 已超过 namespace retention 被删除。关闭时删除：`component_task.rs` 的
`LEGACY_WORKFLOW_ID_PREFIX` 分支与 `task_rerun` 中对应的测试断言、`compose.yaml` 中旧名 SA 的登记、`drill-dr.sh`、RB-04、
RB-10 与 ADR-08 的旧名查询；新录制的基线与各 kind 的 history 入库后，删除旧夹具与重放测试中的 `legacyBaselineKind`。

本地拓扑的迁移（不 `--fresh` 时，按序执行；`--fresh` 重建则全部不需要）：

1. 迁移前确认无在途角色动作（见上），停 `core-bff` 与 `worker`。
2. Compose 项目名改为 `platform-local`：先以旧项目名 `docker compose -p kailo-local down`（不带 `--volumes`），再把六个
   命名卷逐个复制到 `platform-local_<卷名>`（`docker volume create` 后以一次性容器 `cp -a`），确认后删除旧卷。
3. OpenBao raft 的 `node_id` 改为 `platform-local`：单节点 raft 的成员表记着旧 ID，首次以新 ID 启动前在
   `data/secret-store/raft/peers.json` 写入 `[{"id":"platform-local","address":"openbao:8201","non_voter":false}]`
   做一次成员恢复；解封后以 `secret-store-init.sh` 写入新的 `platform-core`、`platform-core-audit`、
   `platform-tenant-provisioner`、`platform-verify` 策略与角色。
4. 本地密钥文件改名：`secrets/kailo_core_client_secret` → `core_client_secret`、`kailo_worker_client_secret` →
   `worker_client_secret`（值不变，IdP 中的 client secret 因此不变）；重跑 `bootstrap.sh` 生成 env 文件。
5. IdP：`.env` 的 `OIDC_NATIVE_MOBILE_REDIRECT_URI` 改为 `…:/platform/oauth2redirect`，重跑 `bootstrap.sh` 渲染导入文件后执行
   `bootstrap.sh --sync-client-redirects`，由它把浏览器与原生客户端的回调收敛到渲染值并回读查证；realm、client ID 不变。
6. 以 `start-core.sh` 启动新 Core（迁移随之执行）与新 Worker，确认正常后删除 OpenBao 平台 namespace 的 `kailo-core`、
   `kailo-verify`，Tenant 父 namespace 的 `kailo-tenant-provisioner`，root namespace 的 `kailo-core-audit` 策略与角色。
已有 Tenant 子 namespace 的 Core 角色按新 app 网段收敛由 Core 启动时自动完成（对每个未删除 Tenant 调用 `ensure_tenant`），
   不需要手工步骤；结果见 `core/verify/neutral-identifiers-migration.md`。
7. 网关配置热加载（运行期开关）；告警与看板按新指标名 `platform.*` 切换，旧时间序列不迁移。
