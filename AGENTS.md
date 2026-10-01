# Kailo implementation workspace

@/home/ubuntu/.codex/RTK.md

本目录是 Kailo 的实现工程根目录。任何 Agent 修改代码前必须先读本文件、`README.md`、与任务对应的实施文档，以及 `/volumes/kailo/.design/README.md`、`01`、`02`、`03` 和受影响领域文档。

`apps/` 是唯一开发工程根，也是独立 Git 仓库根；外层目录承载导航、设计与只读证据，不是第二个开发项目。进入工程后先确认 `git rev-parse --show-toplevel` 指向本目录；提交与 push 只在该 Git 中执行。历史目录迁移、设计版本与提交边界见 [ADR-07](docs/adr/ADR-07-ci-and-branch-protection.md)。缓存、工具安装目录和上游证据目录均不得当作实现工程。

本目录规定的是**结果**：什么必须成立、什么必须留下证据、什么绝不允许。它不规定开发流程——不要求先写规格再实现，也不要求先写测试再写代码。怎么把一件事做对由实现者决定，能否说明它是对的、以及下一个人能否复核，才是这里的约束。

## 强制规则

1. `.design` 是产品与架构合同；本目录不得另立同义实体、状态、权限或 Workflow。
2. `.references` 只读。不得在其中编辑、构建、测试、安装依赖、运行迁移或生成文件；上游代码只用于证据核验与差异分析。
3. 每项实现必须关联一个设计要求、`DD-*`、`SS-*`、`GAP-*` 或 `V-SCN-*`，并在 `05-设计覆盖矩阵.md` 中有归属、在 `06-工程基线规范.md` §1 的格式下有追溯记录。无法建立追溯关系的功能不进入主干。
4. `BLOCKED: GAP-*` 不得用临时绕过、隐藏开关或弱化安全边界启用。
5. `ADAPTER_REQUIRED: SS-*` 必须在独立实现目录中闭合，并留下该接缝在固定 commit 上仍然成立的可复核证据；不得直接修改 `.references` 工作树充当交付物。
6. Core/BFF 保持单一模块化 Rust 服务。不得拆出 Agent Registry、Quota、Capacity、Audit、Observability、Workflow Projection 或 Memory 微服务。
7. Application Worker 使用 Go 与 Temporal Go SDK `v1.48.0`；该版本由 Kailo 选定，不随 Server 内部依赖变化（`SF-TMP-04`）。Workflow 代码遵守确定性与重放门禁；组件 native task 只作为 `ExternalExecution`。
8. Browser 不持有 Nostr 私钥、平台 service credential、SpiceDB/Temporal/OpenMeter/AgentGateway 管理凭据，也不直连 Buzz Relay 或应用组件管理 API。Buzz Desktop 与 Buzz Mobile 按 `DD-75` 本机持有自己的 Nostr 私钥并直连 Relay，但同样不得持有平台 service credential 或任何组件管理凭据，其管理平面一律经 BFF；不得以本机持钥为由放宽任一管理平面准入。
9. 所有用户或 Agent 可达写动作必须经过 scope guard、Action Admission、fresh authorization、所需审批、Quota/Capacity、Audit 与业务可观测性合同。
10. 外部副作用前先持久化 `ActionExecution`、`Operation`、`ExternalExecution` 或等价权威引用；结果不明时进入设计规定的 `UNKNOWN`，不得盲目重放。
11. Secret 只以 `SecretRef` 出现在业务模型、日志、history、测试夹具和错误信息中；真实值由 OpenBao 或受控投递面提供。
12. 前端只使用 Buzz Client Surface 的主题、i18n、Host API 与语义命令；权限判断永远在服务端重做。同一 message key 与主题语义在 TypeScript 与 Dart 两套实现中同源，不得各自定义。
13. 完成一个变更时必须能说明它为什么是对的，并留下下次可复核的证据。证据形式、粒度与产生顺序由实现者自行决定，本目录不规定先写测试或任何固定流程。
14. 数据迁移的适用边界以 `06-工程基线规范.md` §5 为准：当前全新开发库没有旧版在线 writer，历史兼容无适用对象；有已发布旧版本在线运行时必须向前兼容。迁移须包含回滚或停止发布的确定条件；不可逆迁移单独审批。
15. 不把 HTTP `200/202`、消息已投递、cancel accepted、Workflow 投影已写入当作业务终态；终态证据以 `.design` 对应组件合同为准。
16. 不把本地环境、内网、CORS、前端隐藏、默认配置或约定俗成当作认证授权边界。
17. 每个发布产物必须记录源 commit、依赖锁、上游基线、实现的 `SS-*`、适用协议版本、schema 版本与 artifact digest。
18. 上游升级先走 `04-上游适配与升级.md`：每次开工先运行 `tools/upstream_manifest.py status` 了解 `.references` 的上游变化；二开项目以 `upstream_manifest.py sync` 三方合并吸收上游变化，不得用上游新版本整体覆盖树而丢掉 Kailo 改动，也不得覆盖生成手册；与上游原样的差异由 `upstream_manifest.py diff` 求出。二开项目按功能命名目录、内部保持上游原样命名，不做补丁、不在构建时拷贝（ADR-15、ADR-16）。
19. 修改 `.design` 与实现代码必须分开提交和复核；设计变更先于实现变更。
20. 完成声明前必须实际运行任务范围内的格式、静态检查、验证与追溯检查，并报告原始结果。不得以"应该没问题"替代实际执行。
21. 平台核心不得依赖任何业务能力服务（文件存储、文档编辑、知识、数据查询）的存在：平台实体、流程、Workflow kind、门禁与发布不引用具体实现；业务能力只按能力类别与版本化能力契约接入，经 Remote Adapter 或标准协议集成，各自独立数据库与凭据；内置实现只是参考实现，其接缝缺口只阻断自身 release 与 binding（`.design` 架构原则、`DD-87`–`DD-95`）。
22. 本机项目编译、前端构建、工具链验证与发布打包使用镜像内的 Cargo、Go、Node 等工具链；不调用宿主机对应工具链。执行前必读 `07-运行与运维基线.md` §2.1，核对并发构建、资源压力、实际容器或 BuildKit 的 CPU/内存限额和 `/volumes/data` 缓存归属；不以降低 Cargo 并行度代替资源隔离。规则适用于所有队友，文档写入不代表镜像化门禁已验收。

## 代码检索与影响门禁

GitNexus 只分析本独立 Git 内的实现工程。运行前核对实际源码根、`git rev-parse --show-toplevel`、根 `.gitignore` 对 `deploy/local/secrets/` 与 `deploy/local/data/` 的排除、索引资源中的路径、commit、工作树状态与 runner receipt；这些本机目录不进入源码扫描。Git 会向父目录寻找仓库，仅在目录中执行命令仍不能替代根核对。根目录或回执不匹配、索引 stale 或 incomplete 时，不得声称审查完备；不得借 `--skip-git` 冒充提交与索引已对齐。使用当前环境已核验的 runner，不在正式规则中固化临时缓存路径、索引统计或旧外层索引身份。

- 修改函数、类或方法前必须对实际目标执行 upstream `impact`，报告调用方、受影响流程与风险；概念与执行链用 `query`，具名符号用 `context`。文本检索不替代图分析。
- `HIGH` 与 `CRITICAL` 必须在编辑前明确告警，不以其他风险轴豁免。`UNKNOWN` 表示图谱无法回答，须用源码查明动态调用、注册与跨语言消费；零调用集不代表安全或无使用方。
- 提交前必须执行 `detect_changes` 并核对实际提交范围；`partial: true` 或 `truncated: true` 不是干净门禁。安全审查使用已有 PDG 的 `explain`，缺少覆盖或查询失败必须如实报告，不写成没有风险。
- 刷新由当前批次负责人统一安排；只读证据 `.references`、缓存与工具安装树不进入开发工程范围。索引写入、生成指导文件或更改工程配置不能当作只读审查。

## 工程决策边界

数据库产品、消息总线、部署编排、CI 平台、日志后端等未被 `.design` 固定的工程选择，不得隐式写进业务模块。选择前建立 ADR，按正确性、事务语义、故障恢复、运维成本和替换边界评审；ADR 不得改变 `.design` 的权威划分。

## 提交最小信息

每个提交或合并请求至少写明：

- 关联的设计 ID 与验证场景；
- 受影响模块和权威数据；
- schema/API/Workflow compatibility 影响；
- 已运行的验证及结果；
- 新增或解除的发布门禁；
- 对上游源码树改动（`upstream_manifest.py diff`）或 artifact digest 的影响。
