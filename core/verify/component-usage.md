# DD-165 组件计量、额度与用量视图：验证记录

设计：design-authority 之上的 `abe47789ad93464f24659f7dbe67db4ea6bbf86a`（DD-165、SF-OMT-09、
V-SCN-282–276）。本记录只陈述本分支源码与已实际运行的检查；构建、部署与生产业务验收另行记录，
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

## 发布对齐（DD-165(5)，V-SCN-288）

- Core 子命令 `platform-core align-metering`（幂等登记缺失 meter/feature、为 Customer ACTIVE 的业务 Tenant
  补齐默认 entitlement，已存在只核对不覆盖，随后回读；任一缺口以 5 退出并列出）与 `verify-metering`（只读回读）。
- 发布入口（`tools/release/release.yaml` 的 `metering` 段、`node.py` 的 `MeteringStep`）在 core-bff 替换并就绪
  之后、任何其他服务之前执行对齐，Core 未替换时在替换其他服务之前执行；失败即中止 deploy；verify 阶段回读。
- 组件部署入口 `deploy/components/component-deploy.sh` 以 Core 的 `verify-metering` 通过为前置条件，否则拒绝
  部署并列出缺口。组件准入在 Core 尚未登记时得到 `QUOTA_NOT_CONFIGURED`（旧 Core 的 `404` 同样处理），原位
  提示“本组织的用量额度尚未在 Kailo 中完成登记”。

## 合入 main 前的复跑（2026-10-30，`cfcd081a3836b5c15c1c0bc8c3efff5babdc787b`，已含 origin/main `0dc6a97d`）

| 步骤 | 结果 |
|---|---|
| lint | exit 0（cargo fmt、clippy、gofmt、go vet、各 tsc、dart analyze、wren-ui prettier/next lint/tsc） |
| contract | exit 0 |
| migrate | exit 0（前进、回退、再前进；sqlx 同步；枚举约束） |
| verify | exit 0（含 `metering_alignment::tests`、`component_usage::tests`、`tenant_quota::tests`、client-kit、web-client、dart、组件前端） |
| trace、docs | exit 0（44 条追溯记录） |
| `tools/release` 单元测试 | 98 项通过（含 `MeteringAlignment`：Core 后、其他服务前对齐；Core 未替换仍先对齐；失败中止；回读缺口） |
| 组件定向 | WeKnora vet+test ok；Cells vet+test ok；wren-ui jest 5/5、prettier 通过 |

迁移文件自下表的回滚演练以来未变。

## 已运行的检查（2026-10-30，CI 节点，GitHub 固定提交）

`kailo-ci check-step` 只接受 main 可达提交，因此分支提交以同一原入口在 CI 节点的一次性 GitHub 副本内运行
`tools/check.sh`（`CHECK_SOURCE_REF` 固定提交、设计树取 `DESIGN_COMMIT`、临时 PostgreSQL 与线上同一镜像、
tmpfs、独立网络，用后即删）。

| 提交 | 步骤 | 结果 |
|---|---|---|
| `ff956bacec026659bc366c201037e710244fc403` | lint | exit 0：cargo fmt、clippy、gofmt、go vet、client-kit tsc、web-client tsc、dart analyze、wren-ui prettier、next lint、tsc 全部 PASS |
| 同上 | contract | exit 0：四侧生成物同步，相对 `contracts-v0.1.0` 无破坏性变更 |
| 同上 | migrate | exit 0：前进、回退、再前进；sqlx 离线数据同步；65 个命名枚举约束逐值相等 |
| 同上 | verify | exit 0：cargo test（含 `component_usage::tests` 9 项、`tenant_quota::tests` 15 项）、go test、client-kit（`tenant-quotas.test.tsx` 18 项）、web-client vitest、dart test、知识库与云盘前端测试 |
| 同上 | trace、docs | exit 0：文档门禁六项、43 条追溯记录、能力注册表一致、runbook 齐全 |
| `ff956bac…` | 组件定向（检查镜像，GOTOOLCHAIN go1.26.4） | WeKnora `go vet ./internal/application/service/ ./internal/handler/session/` 与 `go test ./internal/application/service/ -run 'KailoUsage\|KailoNotify'` ok；wren-ui `jest src/kailoUsage.test.ts` 5/5 通过、prettier 通过 |
| `47bb6183636fbb91683048f6397c2f292e02bff2`（Cells 源码与 ff956bac 相同） | 组件定向 | Cells `go vet ./common/auth/ ./frontend/web/service/` 与 `go test ./common/auth/ -run NativeOIDC` ok |
| `47bb6183…`（迁移与 ff956bac 相同） | 回滚条件演练 | 迁移前进后：触发器拒绝不对应任何 binding generation 的上报；count meter 数量 2 被 `usage_native_source_shape` 拒绝；存在未 `COMMITTED` 的组件上报时回滚以 `uncommitted component usage reports exist` 停止且不改数据；该行 `COMMITTED` 后回滚成功、删除 outbox 行、恢复原约束并删除成员上限列；再前进成功 |

WeKnora 的 `internal/container` 依赖 cgo sqlite 头文件，检查镜像没有，未在本机 vet；它只增加了一个
`Provide` 与启动注册，随知识库镜像构建（Dockerfile.app 安装 libsqlite3-dev）编译验证。

## 未覆盖

- 二期 meter（知识检索次数、云盘传输字节、文档转换次数、云盘个人空间存储）与云盘上传准入不在本批。
- 未构建、未部署、未做三账号业务验收；生产验收步骤见分支汇报。
