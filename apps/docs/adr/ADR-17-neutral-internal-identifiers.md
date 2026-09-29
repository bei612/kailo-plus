# ADR-17：内部标识去掉产品名——中性固定前缀加一次性兼容窗口（草案）

- 状态：提议（草案，待设计变更先行后接受）
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
