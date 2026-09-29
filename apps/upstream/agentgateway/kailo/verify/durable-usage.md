# SS-AGW-USAGE 接缝证据

对应 `SF-AGW-06`、`SF-AGW-09`、`SS-AGW-USAGE`、`DD-21`。补丁：`patches/0002-durable-usage-outbox.patch`，
基于 `1f7ebbf87cbdbe9517f6f181221879d04dc50692`，叠在 0001 之上。

## 为什么必须改上游

完成请求时 `telemetry/log.rs` 构造 `StoredRequestLog`（`id = uuid v7`）并 `log_store::emit`，记录进进程内
无界 channel，再由 writer 线程批量写库；`flush_log_store_batch` 在 `insert_batch` 失败时只告警，随后无条件
`batch.clear()`（`SF-AGW-09`）。数据库一次抖动就静默丢掉整批计费证据。

## 补丁做了什么

| 位置 | 改动 |
|---|---|
| `telemetry/log.rs`（构造 `StoredRequestLog` 处） | 新字段 `usage_outbox = log.llm_request.is_some()`：每个完成的 LLM 请求都进 outbox，不论 provider 是否报了 token，使「缺计数」与「缺记录」可区分 |
| `telemetry/log_store.rs::flush_log_store_batch` | 只在数据库确认提交后清空批次；失败保留批次，按 0.5s 起、封顶 30s 的指数退避重试；重试前先查已落库的 ID 并剔除（提交成功但确认丢失时不重复、不卡死） |
| 同文件 writer 循环 | 有待重试批次时以 `recv_deadline` 按时醒来；关停时对剩余记录再试 5 次，仍失败则以 error 记录条数与首末 ID |
| `sqlite.rs`/`postgres.rs::insert_batch` | 与 `request_logs` **同一事务**写 `usage_outbox(log_id)`：两者要么都在，要么都不在 |
| `postgres_migrations/0002_create_usage_outbox.sql`、SQLite `SCHEMA` | `usage_outbox(seq 自增, log_id UNIQUE REFERENCES request_logs ON DELETE RESTRICT)`；被 outbox 引用的日志删不掉 |
| `usage_outbox()` + `management/admin.rs` | 新增只读接口 `GET /api/usage/outbox`，挂在 admin router 上，受 0001 的 Core-only 认证保护 |

序号即游标。SQLite 单写者，自增序号天然等于提交顺序；Postgres 在写 outbox 前取
`LOCK TABLE usage_outbox IN EXCLUSIVE MODE`（持有到提交，不阻塞读），多个副本共用一个库时序号也按提交
顺序可见。因此「读到 seq=N 后，将来提交的条目一定 > N」，按游标续读不会漏。

## 给 Core 的读取接口（后续切片按此实现）

```
GET /api/usage/outbox?after=<seq>&limit=<n>
Authorization: Bearer <Core 的 client_credentials 令牌>
```

- `after` 省略即从头读；`limit` 默认 100，范围 1–500；
- 200：`{"entries":[...], "nextCursor": <本页最后一条 seq；无新条目时等于 after>}`，条目按 `seq` 升序；
- 每条：`seq`、`id`（稳定 request-log ID）、`startedAt`、`completedAt`、`traceId`、`spanId`、`httpStatus`、
  `error`、`genAi{operationName,providerName,requestModel,responseModel}`、
  `usage{inputTokens,outputTokens,totalTokens}`、`cost`、`agentgatewayUser`、`agentgatewayGroup`、
  `attributes`（含 `agw.ai.usage.cost.*` 明细，页数计费取 `agw.ai.usage.cost.pages`）。不含 prompt/completion 正文；
- 503 `request log database is not configured`：网关没有配日志库，即没有 durable usage——Core 应显示
  `BILLING_UNAVAILABLE`，不得当作零用量；
- 401/403：认证失败（见 `admin-authentication.md`）。

条目永不删除、不改写，同一游标重复读得到同样结果。Core 按 `.design/11` §4 第 6 条把 `nextCursor` 存进
`IngressCheckpoint(source_key=agentgateway-durable-usage-tail)`；游标晚写只会重读，UsageEvent 以
`id` 去重。

## 仍然成立的边界

持久点是数据库提交。进程在记录入库前被杀（例如数据库不可用期间重启），内存中的待写记录仍会丢失；
关停时的丢失会以 error 日志给出条数与首末 ID。补丁消除的是「写库失败即丢」这条路径，不声称恢复写库前
已丢的记录（`.design/04` §11）。outbox 没有清理：删除需要 Core 的确认协议，属于后续切片。

## 实测（2026-09-29）

新增 `telemetry/log_store_tests.rs`，同一组场景分别跑 SQLite 与 Postgres：

| 用例 | SQLite | Postgres 16 |
|---|---|---|
| `usage_outbox_holds_llm_records_in_commit_order`：只有 LLM 记录进 outbox；seq 递增；游标续读只返回之后条目；耗尽的游标原样返回；响应不含 prompt | 通过 | 通过 |
| `failed_flush_keeps_records_until_persisted`：outbox 表不可写时批次保留、request_logs 同事务回滚为 0；退避期内不重试；恢复后一次写入、各一条 | 通过 | 通过 |
| `retry_after_unacknowledged_commit_writes_each_record_once`：模拟「已提交但确认丢失」后重试，不重复、不报主键冲突 | 通过 | 通过 |
| `outbox_keeps_its_request_logs`：被引用的日志删除失败，未引用的可删 | 通过 | 通过 |

Postgres 用例需要一个可清空的库，默认 `ignore`：

```
AGENTGATEWAY_TEST_POSTGRES_URL=postgres://... cargo test -p agentgateway --lib \
  telemetry::log_store::tests::postgres_backend -- --ignored --test-threads=1
```

本次用临时 `initdb` 起的 Postgres 16 跑通。`management/admin_tests.rs::usage_outbox_requires_admin_client_and_request_log_database`：
无令牌 401；有令牌但未配日志库 503。

破坏核验：在 `flush_log_store_batch` 的失败分支恢复上游的 `batch.clear()`，
`failed_flush_keeps_records_until_persisted` 失败；还原后通过。

## 部署前提

- 网关必须配置 `config.logging.database`（或通用 `config.database`），生产用 Postgres；该库账号需要
  建表权限以执行迁移。数据库按 DD-93 放在网关自己的私有数据网络；
- Core 只经 admin 接口读取，不直连这个库。
