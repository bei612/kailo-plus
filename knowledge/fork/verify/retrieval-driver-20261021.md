# WeKnora 检索驱动声明与被跳过 embedding 结构的修复迁移

对应 DD-128(5) 与 SF-WEK-18（design-authority `832a473821efa89ec3b9d0b6f67673a8b236510d`）。
本记录是源码与隔离验证证据，不代表生产已迁移或已完成知识库问答验收。

## 缺陷与根因

生产验收（binding `9bd03b28-e85d-5112-b9e3-8a94d7418f33`，2026-10-20）中，平台模型经 Gateway
完成了文档摘要、问题理解与 query embedding，但 `knowledge_search` 命中 0 条、回答为空。
`knowledge/fork/deploy/compose.yaml` 的 app 环境没有声明 `RETRIEVE_DRIVER`（上游 Compose 缺省
`postgres`），启动日志为 `RETRIEVE_DRIVER=<unset>`：

- `internal/container/container.go::initRetrieveEngineRegistry` 没有登记任何检索引擎，
  `knowledgebase_search.go::HybridSearch` 记录 "No retrievable indexing pipelines" 并返回空；
- `initDatabase` 以 `app.skip_embedding=true` 迁移：`000002` 未建 `embeddings` 表与索引，
  `000007`、`000059` 因表不存在跳过，`000008`、`000011`、`000099` 未更新 pg_search；
  这些版本已记为执行。生产回读：没有 `embeddings` 表，`schema_migrations` 为 107、未 dirty。

## 修复

- 部署：`compose.yaml` app 固定 `RETRIEVE_DRIVER: postgres`（该部署单元只有 ParadeDB，其他驱动需要
  另外的存储，不作为可配置项）；`native_entrypoint.py` 要求其值恰为 `postgres`，否则拒绝启动；
  `start.sh` 在 Compose 之前拒绝不含该声明的 `compose.yaml`，`component-deploy.sh knowledge`
  （含 `--check`）都经过它。
- 迁移 `migrations/versioned/000108_restore_skipped_embedding_schema`（接在 Kailo 的
  000104..000107 之后，golang-migrate 同一格式）：`app.skip_embedding=true` 时为空操作；表已存在时
  只以 IF NOT EXISTS/存在性检查重放同名同定义的索引，不更新扩展（即对从未跳过的库为空操作）；
  表不存在时按原顺序补齐 000002/000007/000059 的表、唯一/BM25/HNSW 索引与列，并补做
  000008/000011/000099 的 pg_search 更新与 000095 的 memory 向量列。down 为空操作：补齐后的结构
  与正常初始化不可区分，删除它属于 000002 自己的 down。
- 限制：若某部署在未声明 postgres 时执行到 108，108 记为空操作，之后改设驱动不会再补齐；本部署单元
  的入口拒绝无 postgres 启动，108 只会在已声明驱动时执行。
- 已上传文档在补齐前没有写入向量与 BM25 索引，需经原生界面或原生 API 重新解析。

## 验证（2026-10-21，CI 节点，分支 `fix/weknora-retrieve-driver` 的 GitHub 取码）

结构对比 `knowledge/fork/deploy/retrieval-schema-check.sh`，提交
`81f12c16591f08b8887a62594688e1e324347811`，日志 `/volumes/data/kailo/ci/tmp/weknora-schema-check.log`：
compose 固定的 ParadeDB `paradedb/paradedb@sha256:58bf87d2…`，内部网络、tmpfs 数据；迁移由
knowledge-service `18bf5721…` 镜像内与应用同锁定版本的 `migrate` 执行。

- 正常初始化（skip=false）到 107，再到 108；跳过初始化（skip=true）到 107，再以 skip=false 到 108；
- `PASS skipped initialisation lacks embeddings (9 embeddings indexes absent)`；
- `PASS no-op-on-normal (1578 structural facts identical)`：108 前后表、列、约束、序列、索引定义、
  扩展版本完全一致；
- `PASS repaired-equals-normal (1579 structural facts identical)`：补齐后与正常初始化完全一致
  （含 `schema_migrations` 版本行）；
- 版本断言把 psql 的布尔输出 `false` 误判为不符，已修正比较式；重跑结果见下。

单元测试：`knowledge/fork/deploy` 下 `python3 -m unittest test_native_entrypoint` 37 passed（新增入口
拒绝空、其他驱动或组合值，`start.sh` 拒绝缺失、改值或注释掉的声明）；
`deploy/components` 下 `test_native_*.py` 35 passed。

## 生产验收（2026-10-21）

发布：main `aa89807eed1446a57a97dc0fa8998db1497325f5`（full 检查通过），knowledge-service 重建为
`caae31a2b888634237c624e9bd65bba143f60f48c23f9cdd9ee012d025184d48`。

### 部署与迁移

- 组件 env 的 `KNOWLEDGE_APP_DIGEST` 换为上述 digest，原子替换，备份为
  `native.env.bak-20261021T020530Z-retrieve`；发布树内带 `KAILO_RUNTIME_DIR=/volumes/kailo/apps/deploy/local`
  运行 `component-deploy.sh knowledge aa89807e… --check` 与正式部署，均 rc=0，日志
  `/volumes/data/kailo/ci/tmp/weknora-deploy-retrieve.log`，数据库备份
  `/volumes/data/kailo/backups/components/knowledge/20261021T020553Z/weknora.dump`。
- app 启动日志：`RETRIEVE_DRIVER=postgres`、`Skip embedding: false`、
  `Register postgres retrieve engine success`、`Current migration version: 108, dirty: false`。
- 主会话读库确认：`schema_migrations` 为 108、`dirty=false`；`embeddings` 表存在，其上 9 个索引，
  与结构对比的数量一致。

### 重新解析

qa-1 经 Kailo 侧栏「知识库」进入 WeKnora 原生页面，在知识库 `r-accept-星河兰花温室`
（`41d97da5-9a5d-4cd5-aebf-2e2b69732411`）的文档 `r-accept-xinghe-orchid-greenhouse.md`
（knowledge `caaaf3af-df7d-4ddc-9f76-b776368c64d7`）卡片菜单选「重建知识」，确认后在「重新解析确认」
沿用原解析配置点「确认并重新解析」：原生 `POST /api/v1/knowledge/caaaf3af-df7d-4ddc-9f76-b776368c64d7/reparse`
返回 200（02:27:37Z），约 1.5 分钟后摘要重新生成（02:29:16），文档可检索。

### 提问与答案

在「新对话」以 @ 限定该知识库，智能体「快速问答」，模型 `kailo-platform-chat`（平台 chat route
`62f190fc-c993-4351-aa32-dbcc3c763af2` 的内置模型行）。

- 问题：星河兰花温室的负责人是谁？每年哪天举办开放日？灌溉用水取自哪里？
- 答案原文（助手消息 `content`）：

  > 星河兰花温室的负责人是**林栖梧**；每年 **4 月 18 日** 举办开放日（当天免费向市民开放）；灌溉用水取自**翠屏湖**（水温常年保持在 21 摄氏度）。<kb doc="r-accept-xinghe-orchid-greenhouse.md" chunk_id="29523ba2-9020-488c-844b-2e2e2c507570" kb_id="41d97da5-9a5d-4cd5-aebf-2e2b69732411" />

| 项 | 文档原文 | 答案 | 结果 |
| --- | --- | --- | --- |
| 负责人 | 温室负责人：林栖梧 | 林栖梧 | 一致 |
| 开放日 | 每年 4 月 18 日举办一次开放日，当天免费向市民开放 | 每年 4 月 18 日，当天免费向市民开放 | 一致 |
| 水源 | 灌溉用水取自翠屏湖，水温常年保持在 21 摄氏度 | 翠屏湖，水温常年保持在 21 摄氏度 | 一致 |

ID：会话 `6f754532-683c-40f9-b8e5-8b56d120f875`（标题「查询星河兰花温室信息」）；用户消息
`f9b55f1c-f994-4a5d-b603-5373fab721f9`；助手消息 `a96e00c8-2487-49bb-93d6-c0a182fdc499`，request
`9zbUmv7zsOq9`，`knowledge_search` 命中 2 条、`knowledge_references` 2 条、非降级；引用分块
`29523ba2-9020-488c-844b-2e2e2c507570`。

修复前对照：同一知识库与问题的会话 `c06e5227-903e-4606-8edb-7c6a5a2a21fc`、助手消息
`bf27e2bf-33df-4099-a937-0349498369a9`，问题理解成功、query embedding 经 Gateway 返回 2560 维，但
日志 "No retrievable indexing pipelines across 1 KBs"，`knowledge_search` 0 条，`is_fallback=true`，
回答为空。

### 截图

CI 节点 `/home/ubuntu/kailo-acceptance/component-flow/weknora-ask/out/`：

| 文件 | 内容 |
| --- | --- |
| `21-doc-menu.png` | 文档菜单「重建知识」 |
| `22-reparse-confirm.png` | 重建确认 |
| `23-reparse-started.png` | 重新解析配置 |
| `24-reparse-submitted.png` | 提交后 |
| `25-reparse-done.png` | 摘要重新生成、文档可检索 |
| `13-question.png` | 问题限定到该知识库 |
| `26-answer.png` | 答案与引用文档 |
| `14-answer.png` | 修复前的空答案 |

### 计量与审计（主会话 2026-10-21 直接读生产库）

- binding `9bd03b28-e85d-5112-b9e3-8a94d7418f33`：`ACTIVE`，version 2；
- `component_model_tokens`：24 条，全部 `COMMITTED`，合计 17246 token；
- 审计：`MODEL_CALL_ADMITTED` 24 条、`MODEL_DISCOVERY_ADMITTED` 1 条、`BILLING_UNAVAILABLE` 0 条；
  24 条调用准入审计与 24 条计量一一对应；
- 计量游标 393，持续前移。
