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

## 发布后待做

部署后回读迁移版本 108 与 `embeddings` 表存在，以 qa-1 对 `r-accept-星河兰花温室` 的文档重新解析并
重新提问；结果记入本文件。
