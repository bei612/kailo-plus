# Kailo 第一期纯设计

本目录只描述第一期产品（Buzz Web、Buzz Desktop、Buzz Mobile 三端）的领域、架构、治理契约、组件接缝和交互场景。它不包含开发任务、部署命令、迁移步骤或发布计划。

## 架构原则（最高判据）

Kailo 是多人、多 Agent **协作管理平台**。设计分两层，任何文档与本节冲突，以本节和 `02` 的 DD-87 为准：

- **平台核心**（强集成、不可替换）：Core/BFF、Application Worker、Buzz Relay 与三端 Client Surface、Codex、AgentGateway、SpiceDB、Temporal、OpenBao、OpenMeter。它们共同构成协作、Agent 与统一治理，本身就是完整产品。
- **业务能力服务**（松耦合、可缺席、可替换）：文件存储、在线文档编辑、知识库、数据查询（text2sql）及以后同类服务，最终为人与 Agent 提供数据或工具。

业务能力服务必须同时满足五条（DD-87）：

1. **平台独立成立**：零业务能力 binding 时平台全部核心能力可用；平台实体、流程、Workflow kind 与门禁不依赖任何业务能力服务。
2. **数据平面解耦**：各服务自持数据与执行，服务之间不直连数据面、不共用数据库；平台不编排跨服务数据同步（DD-89）；人与 Agent 只经服务按能力契约暴露的 Resource/Action/Tool 访问。
3. **管理平面集成**：服务的管理面只经平台前端 Component Host 露出，认证、授权、审批、Quota/计费、审计、观测平台公用。
4. **完全可替换**：平台只认能力类别与版本化能力契约（DD-88），内置服务只是参考实现，外部同类服务按同一契约替换。
5. **只经配置与协议**：由 Catalog/ApplicationBinding 配置与 Adapter Protocol、MCP 等协议集成；各服务数据库与凭据独立（DD-93）。

## 阅读顺序

1. [产品边界与术语](01-产品边界与术语.md)
2. [源码证据与设计决策](02-源码证据与设计决策.md)
3. [领域模型与权限模型](03-领域模型与权限模型.md)
4. [紧凑总体架构与端到端交互](04-紧凑总体架构与端到端交互.md)
5. [统一治理设计](05-统一治理设计.md)
6. [Temporal 任务工作台](06-Temporal任务工作台.md)
7. [组件接入标准](07-组件接入标准.md)
8. [内置组件与交互场景](08-内置组件与交互场景.md)
9. [统一身份与 Buzz 协议投影](09-统一身份与Buzz协议投影.md)
10. [授权、审批与撤权一致性](10-授权审批与撤权一致性.md)
11. [容量、Quota、计量、审计与业务可观测性](11-容量Quota计量审计与业务可观测性.md)
12. [Agent 运行时与工具安全](12-Agent运行时与工具安全.md)
13. [业务能力实现的增量更新与跨服务数据获取（内置参考实现）](13-资源增量更新与物化.md)
14. [全局业务可观测性设计](14-全局业务可观测性设计.md)
15. [最终源码可行性分析](15-最终源码可行性分析.md)
16. [设计验证矩阵](16-设计验证矩阵.md)
17. [Agent 管理平面设计](17-Agent管理平面设计.md)
18. [文件存储与在线编辑内置参考实现（Cells + ONLYOFFICE）](18-ONLYOFFICE文档协作集成设计.md)
19. [Agent 记忆体系设计](19-Agent记忆体系设计.md)

## 权威规则

- `01` 是产品边界和术语权威。
- `02` 是第三方源码事实、二开接缝、设计决策和阻断项权威。
- `03` 是平台实体、关系、状态和权限权威。
- `05` 是八维贯穿治理规则权威。
- `06` 是审批、Workflow 和任务工作台生命周期权威。
- `07` 是平台级/应用级组件、不可变 ComponentRelease、PlatformProviderBinding、ApplicationBinding、Component Host（Buzz Web 与 Buzz Desktop 承载）与后端 Adapter Protocol 的接入权威。
- `08`、`13`、`18` 是**内置参考实现文档**：只把平台权威应用到一期内置的业务能力实现，说明它们如何满足能力契约；不得给平台新增实体、权限、Workflow kind、端口或门禁，其中的产品细节不是平台前提。
- `09`–`12` 是身份投影、授权撤销、容量/计量/审计/业务可观测性、Agent 安全的专项约束；实体字段仍以 `03` 为准。
- `13` 说明业务能力实现内部的增量更新与对账，以及跨服务数据获取如何按 DD-89 经授权由接收方自行完成；平台不编排跨服务同步。
- `14` 是全平台业务操作时间线、用户行为审计接缝与 Tenant/Workspace 业务聚合视图权威；不包含基础设施监控。
- `15` 是总体可行性与阻断结论权威。
- `16` 是要求、治理、交互和源码边界的设计验证权威。
- `17` 是 Agent 定义、不可变版本、Workspace 安装、Channel 触发、运行时投影与管理交互权威；实体字段仍以 `03` 为准。
- `18` 说明内置“文件存储与在线编辑”参考实现（Cells 与 ONLYOFFICE 作为一个能力组件，WOPI 为其内部集成）如何满足 `FILE_STORAGE` 与 `DOCUMENT_EDITING` 能力契约；实体与通用组件规则仍以 `03`、`07` 为准。
- `19` 是 Agent 协作历史、Codex 会话恢复与 Buzz NIP-AE 长期记忆的专项权威（企业知识按 DD-92 是可选的 `KNOWLEDGE` 能力，不属于记忆层）；实体字段仍以 `03` 为准，运行安全仍以 `12` 为准。
- Buzz Client Surface 的主题与 i18n 是全部前端 surface 的一致性权威，跨 TypeScript 与 Dart 两套实现成立（REQ-08）；逻辑合同以 `03` 为准，组件接入约束以 `07` 为准。

## 证据纪律

正式设计声明分为“证据类型”和“能力状态”，两者不得混用。

| 类型 | 含义 |
|---|---|
| `REQUIREMENT` | 用户确认的产品要求 |
| `SOURCE_FACT` | 固定 commit 的源码、协议类型、迁移或测试直接证明的行为 |
| `SOURCE_SEAM` | 精确源码位置能够承载的二开边界 |
| `DERIVED_DESIGN` | 由 Requirement 与 Source Fact/Seam 共同推出的设计 |
| `BLOCKED` | 源码接缝不足；对应能力不得注册或展示 |
| `EXCLUDED` | 一期明确不进入产品运行链 |

能力状态只有四种：

| 状态 | 确定含义 |
|---|---|
| `UPSTREAM_SUPPORTED` | 固定 commit 已直接提供该行为；仍须满足其明确配置前提 |
| `ADAPTER_REQUIRED` | 固定 commit 已证明协议相交与精确改动接缝，但原始源码尚不满足 Kailo 合同；适配闭合前不得 active |
| `DESIGN_DEFINED` | Kailo 的领域、权限或交互合同已经闭合；它不是“上游已实现”的声明 |
| `BLOCKED` | `.references` 缺少不可替代的源码或依赖；对应 Resource、Action、Tool、Route、Workflow 不得 active |

`EXCLUDED` 仍表示一期明确不进入运行链。能力状态仅允许上表四种，禁止另造中间状态；源码能力、二开接缝、平台设计和当前可运行性必须分开表达。

`.references` 是唯一第三方事实来源。项目被 clone 不代表它成为产品依赖；上游更新后只重验受影响的 SOURCE_FACT/SOURCE_SEAM 和其关联决策。

Mattermost 是运行时 manifest/registry/lifecycle 的 `REFERENCE_ONLY` 证据，不进入一期运行拓扑；Component Host 仍是 `ADAPTER_REQUIRED` 的一次性主体二开，需在 Buzz Web 与 Buzz Desktop 两端各实现一次同一契约。后续只有满足 `07` 全部兼容边界的 release 才能不重发 Core/Buzz Web运行时注册。
