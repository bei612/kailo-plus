# Kailo implementation workspace

@/home/ubuntu/.codex/RTK.md

本目录是 Kailo 的实现工程根目录。任何 Agent 修改代码前必须先读本文件、`README.md`、与任务对应的实施文档，以及 `/volumes/kailo/.design/README.md`、`01`、`02`、`03` 和受影响领域文档。

本目录规定的是**结果**：什么必须成立、什么必须留下证据、什么绝不允许。它不规定开发流程——不要求先写规格再实现，也不要求先写测试再写代码。怎么把一件事做对由实现者决定，能否说明它是对的、以及下一个人能否复核，才是这里的约束。

## 强制规则

1. `.design` 是产品与架构合同；本目录不得另立同义实体、状态、权限或 Workflow。
2. `.references` 只读。不得在其中编辑、构建、测试、安装依赖、运行迁移或生成文件；上游代码只用于证据核验与差异分析。
3. 每项实现必须关联一个设计要求、`DD-*`、`SS-*`、`GAP-*` 或 `V-SCN-*`，并在 `05-设计覆盖矩阵.md` 中有归属、在 `06-工程基线规范.md` §1 的格式下有追溯记录。无法建立追溯关系的功能不进入主干。
4. `BLOCKED: GAP-*` 不得用临时绕过、隐藏开关或弱化安全边界启用。
5. `ADAPTER_REQUIRED: SS-*` 必须在独立实现目录中闭合，并留下该接缝在固定 commit 上仍然成立的可复核证据；不得直接修改 `.references` 工作树充当交付物。
6. Core/BFF 保持单一模块化 Rust 服务。不得拆出 Agent Registry、Quota、Capacity、Audit、Observability、Workflow Projection 或 Memory 微服务。
7. Application Worker 使用 Go 与 Temporal Go SDK `v1.48.0`。Workflow 代码遵守确定性与重放门禁；组件 native task 只作为 `ExternalExecution`。
8. Browser 不持有 Nostr 私钥、平台 service credential、SpiceDB/Temporal/OpenMeter/AgentGateway 管理凭据，也不直连 Buzz Relay 或应用组件管理 API。Buzz Desktop 与 Buzz Mobile 按 `DD-75` 本机持有自己的 Nostr 私钥并直连 Relay，但同样不得持有平台 service credential 或任何组件管理凭据，其管理平面一律经 BFF；不得以本机持钥为由放宽任一管理平面准入。
9. 所有用户或 Agent 可达写动作必须经过 scope guard、Action Admission、fresh authorization、所需审批、Quota/Capacity、Audit 与业务可观测性合同。
10. 外部副作用前先持久化 `ActionExecution`、`Operation`、`ExternalExecution` 或等价权威引用；结果不明时进入设计规定的 `UNKNOWN`，不得盲目重放。
11. Secret 只以 `SecretRef` 出现在业务模型、日志、history、测试夹具和错误信息中；真实值由 OpenBao 或受控投递面提供。
12. 前端只使用 Buzz Client Surface 的主题、i18n、Host API 与语义命令；权限判断永远在服务端重做。同一 message key 与主题语义在 TypeScript 与 Dart 两套实现中同源，不得各自定义。
13. 完成一个变更时必须能说明它为什么是对的，并留下下次可复核的证据。证据形式、粒度与产生顺序由实现者自行决定，本目录不规定先写测试或任何固定流程。
14. 数据迁移必须向前兼容正在运行的旧版本，包含回滚或停止发布的确定条件；不可逆迁移单独审批。
15. 不把 HTTP `200/202`、消息已投递、cancel accepted、Workflow 投影已写入当作业务终态；终态证据以 `.design` 对应组件合同为准。
16. 不把本地环境、内网、CORS、前端隐藏、默认配置或约定俗成当作认证授权边界。
17. 每个发布产物必须记录源 commit、依赖锁、上游基线、实现的 `SS-*`、适用协议版本、schema 版本与 artifact digest。
18. 上游升级先走 `04-上游适配与升级.md`，不得直接覆盖 fork、patch 或生成手册。
19. 修改 `.design` 与实现代码必须分开提交和复核；设计变更先于实现变更。
20. 完成声明前必须实际运行任务范围内的格式、静态检查、验证与追溯检查，并报告原始结果。不得以"应该没问题"替代实际执行。

## 工程决策边界

数据库产品、消息总线、部署编排、CI 平台、日志后端等未被 `.design` 固定的工程选择，不得隐式写进业务模块。选择前建立 ADR，按正确性、事务语义、故障恢复、运维成本和替换边界评审；ADR 不得改变 `.design` 的权威划分。

## 提交最小信息

每个提交或合并请求至少写明：

- 关联的设计 ID 与验证场景；
- 受影响模块和权威数据；
- schema/API/Workflow compatibility 影响；
- 已运行的验证及结果；
- 新增或解除的发布门禁；
- 对上游 patch、fork 或 artifact digest 的影响。
