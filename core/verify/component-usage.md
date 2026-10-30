# DD-163 组件计量、额度与用量视图：验证记录

设计：design-authority 之上的 `83032bd9a6771199f19e52f147fc81244f140243`（DD-163、SF-OMT-09、
V-SCN-271–276）。本记录只陈述本分支源码与已实际运行的检查；构建、部署与生产业务验收另行记录，
不以本记录代替。

## 范围

- Core：部署引导登记 `knowledge_answer_count`、`data_query_count`、`file_storage_bytes` 三个组件 meter
  与 `component_tokens`、`knowledge_answers`、`data_queries`、`file_storage` 四个额度项（默认额度同一意图
  路径补齐）；`tenant.quota.set` 接受成员上限（只对带成员维度的两项，写在同一 entitlement metadata）；
  服务面 `POST /service/v1/component-usage/bindings/{binding}/reports` 与 `/admission`（目录 client 认证，
  `COMPONENT_REPORT` UsageEvent，`(binding, idempotencyKey)` 去重）；模型调用 ExtAuthz 逐调用 CHECK
  `component_tokens`；BFF `GET /api/v1/usage/me` 与 `GET /api/v1/usage/components`。
- 迁移 `20261102020000_component_usage`：额度意图的额度项集合与成员上限列、UsageEvent 新来源的形状约束与
  冻结守卫；回滚在存在未 `COMMITTED` 的组件上报或新额度项的设置意图时停止。
- client-kit：用量页「我的用量」「组织额度」（七项、成员上限、云盘按 GiB 输入）与「按组件用量」。
- 组件：WeKnora 问答在 `KnowledgeQA`/`AgentQA` 入口准入、在 assistant 消息完成汇点上报；Wren 在
  `createAskingTask`/`rerunAskingTask` 前准入、建立后以原生 query ID 上报；Cells 每小时上报存储快照。

## 已运行的检查

见同目录下本批 CI 回执段落（由运行结果回填）。

## 未覆盖

- 二期 meter（知识检索次数、云盘传输字节、文档转换次数、云盘个人空间存储）与云盘上传准入不在本批。
- 未构建、未部署、未做三账号业务验收；生产验收步骤见分支汇报。
