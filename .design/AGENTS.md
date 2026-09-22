# Kailo design workspace

@/home/ubuntu/.codex/RTK.md

本目录是纯设计权威，不是实施仓库。

## 强制规则

1. 修改前读取 `README`、`01`、`02`、`03` 和受影响领域文档。
2. `/volumes/kailo/.references` 是第三方事实唯一来源；先读取其 `AGENTS.md`、`UPDATE_TASKS.json`、相关阅读手册和固定源码。
3. 每条 SOURCE_FACT/SOURCE_SEAM 必须在本行或紧邻基线写项目完整 commit，并给出从 `.references` 根开始的完整路径及符号、迁移或测试。
4. 源码直接行为写 SOURCE_FACT；平台选择只能写 DERIVED_DESIGN，并同时引用 Requirement 与 Source Fact/Seam。
5. 搜索未发现不构成全项目否定；不能证明的能力登记为 BLOCKED，并从 Resource、Action、Tool、Route 和 Workflow 中移除。
6. `01` 是术语权威，`03` 是实体、字段、状态与关系权威；其他文档不得建立同义模型。
7. Temporal 是持久 Workflow 和 Approval 生命周期权威；组件 native task 只作 ExternalExecution。
8. 每个 Resource 有一个 HUMAN accountable owner；Asset 默认继承，Agent/service 只能是 producer。
9. 所有治理入口都必须有 Tenant、Workspace、Authorization、Approval、Workflow、Quota/Billing 和 Audit 的确定策略；内部权威查询不得递归建立新动作。
10. 组件不必原生具有 Kailo Tenant/Workspace，但 binding、隔离和调用身份必须有源码证据。
11. `.references` 保持只读；本目录不记录拉取、构建、测试、发布、工程任务或时间表。
12. 正式设计禁止 `TODO`、`TBD`、`可能`、`待实现`、`待 PoC` 和无依据兼容承诺。
13. 设计验证只描述输入、权威判断、状态变化和禁止结果，不写测试代码或执行步骤。
14. 每条 SOURCE_FACT/SOURCE_SEAM 的路径与符号在写入前必须于目标提交实际解析（`git show <commit>:<path>`、`git grep <pattern> <commit> -- <path>`）；路径存在不等于内容仍支持断言，须核对被引内容。`mattermost`、`edgequake` 为稀疏检出，不得依赖工作树检索。上游重验以目标提交的树状态为准，不以单个 commit 的 diff 下结论。
15. 引用的 commit 默认为该 clone 的手册基线（HEAD）；当平台实际依赖固定版本（如 Server `go.mod` 钉定的 SDK tag）时，可引用该 tag commit，但它必须是 clone HEAD 的祖先，且 `02` §1 表须同时列出 HEAD、tag commit 与两者关系，并有一条 SOURCE_FACT 说明 tag..HEAD 对被引符号的影响。
