# Kailo 第一期纯设计

本目录只描述第一期 Web 产品的领域、架构、治理契约、组件接缝和交互场景。它不包含开发任务、部署命令、迁移步骤或发布计划。

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
13. [资源增量更新与物化](13-资源增量更新与物化.md)
14. [全局业务可观测性设计](14-全局业务可观测性设计.md)
15. [最终源码可行性分析](15-最终源码可行性分析.md)
16. [设计验证矩阵](16-设计验证矩阵.md)
17. [Agent 管理平面设计](17-Agent管理平面设计.md)
18. [ONLYOFFICE 文档协作集成设计](18-ONLYOFFICE文档协作集成设计.md)
19. [Agent 记忆体系设计](19-Agent记忆体系设计.md)

## 权威规则

- `01` 是产品边界和术语权威。
- `02` 是第三方源码事实、二开接缝、设计决策和阻断项权威。
- `03` 是平台实体、关系、状态和权限权威。
- `05` 是八维贯穿治理规则权威。
- `06` 是审批、Workflow 和任务工作台生命周期权威。
- `07` 是平台级/应用级组件、不可变 ComponentRelease、PlatformProviderBinding、ApplicationBinding、Component Host（Buzz Web 与 Buzz Desktop 承载）与后端 Adapter Protocol 的接入权威。
- `08` 只把前述权威应用到首批组件，不另创概念。
- `09`–`12` 是身份投影、授权撤销、容量/计量/审计/业务可观测性、Agent 安全的专项约束；实体字段仍以 `03` 为准。
- `13` 是跨 Resource 增量物化、CocoIndex 边界和增量失败语义权威。
- `14` 是全平台业务操作时间线、用户行为审计接缝与 Tenant/Workspace 业务聚合视图权威；不包含基础设施监控。
- `15` 是总体可行性与阻断结论权威。
- `16` 是要求、治理、交互和源码边界的设计验证权威。
- `17` 是 Agent 定义、不可变版本、Workspace 安装、Channel 触发、运行时投影与管理交互权威；实体字段仍以 `03` 为准。
- `18` 是 ONLYOFFICE WOPI editor surface、Cells 文件权威和文档交互的专项权威；实体与通用组件规则仍以 `03`、`07` 为准。
- `19` 是 Agent 协作历史、Codex 会话恢复、Buzz NIP-AE 长期记忆与企业知识边界的专项权威；实体字段仍以 `03` 为准，运行安全仍以 `12` 为准。
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
