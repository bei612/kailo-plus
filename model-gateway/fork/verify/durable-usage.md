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

## 全量源码重试计数纠偏（2026-10-01）

本次直接修改 `crates/agentgateway/src/telemetry/log_store.rs::flush_log_store_batch`，不生成或维护补丁。
设计依据仍是 `DD-21`、`SS-AGW-USAGE` 的持久化证据边界；没有新增计量权威、Core consumer 或配置项。

原逻辑在重试查到已提交记录后将它们移出批次，但只在随后整个批次成功时扣减 backlog。
若剩余记录再次写入失败，已移出的记录没有退账；下一次成功只扣剩余记录，backlog 因而永久残留。
修正按移出记录的实际数量立即退账，随后提交成功只扣仍在批次中的数量。
`emit` 每条记录入账一次、发送失败退账一次；查询失败、退避和未确认提交均不扣未确认记录。

`flush=false` 只说明待写批次尚未全部确认，不否定旧的已提交 outbox 页。
两种 backend 的 request log 与 outbox 仍在同一事务中提交，读取到的条目已有数据库提交证据。
本次没有修改 `process_log_store_msg`、admin router、HTTP 状态码、游标或响应字段；返回旧页不是将待写批次宣告成功，
也不是宣告没有尚未确认的用量。不因本次计数修正宣告 `SS-COD-TRACE` 或 Stage 5 用量归因链已闭合。

### 实现后真实核验

生产修正先写入，再临时增强原有 `retry_after_unacknowledged_commit_writes_each_record_once`，
复用原 `TestDb`、`record` 与三个既有记录，不新增用例、夹具、文件或脚本：
原库中已提交 `a,b`，原待写批次为 `a,b,c`；临时改名 outbox 表，使查询确认 `a,b` 后的 `c` 写入事务失败。
核验批次只剩 `c`、已提交日志仍为两条、backlog 只比原值多一；恢复表后保留原来的三条日志及 outbox `a,c` 去重断言，
并核验 backlog 回到原值。这不是对 Atomic 的手工加减验证。

每轮均先检查现有构建进程、CPU、内存与 pressure；首次可用内存 24 GiB、memory PSI avg10=0。
实际使用 Rust 1.95、仓库已有 `ci` profile、`CARGO_HOME=/home/ubuntu/.cargo`、
`CARGO_TARGET_DIR=/volumes/data/kailo/cache/gateway-ci-target`、`TMPDIR=/volumes/data/kailo/tmp`。
执行位于独立 systemd cgroup，实际限制为 `MemoryMax=12G`、`MemorySwapMax=0`、`CPUQuota=600%`、`TasksMax=8192`；
未降低 Cargo 并行度，未启动 builder，未修改缓存权限，未触碰当前网关数据库或 `.references`。

```bash
cargo test --locked --profile ci -p agentgateway --lib telemetry::log_store::tests -- --test-threads=1
cargo test --locked --profile ci -p agentgateway --lib \
  telemetry::log_store::tests::sqlite_backend::retry_after_unacknowledged_commit_writes_each_record_once \
  -- --exact --test-threads=1
```

上面两个实际 Cargo 命令分别用于整个原范围和原单用例；四轮均通过 `sudo -n systemd-run --wait --pipe --collect`
投递上述环境与 cgroup 属性，从当前 `apps/model-gateway` 源树执行。
原始日志位于 `/volumes/data/kailo/tmp/`：

| 阶段 | 实际退出码与结果 | 日志文件 |
|---|---|---|
| 生产修正后、原用例临时增强 | 0；5 passed、0 failed、4 ignored | `codex-s5-backlog-existing-tests-enhanced-20261001.log` |
| 仅将新退账行临时换为 `let _ = confirmed` | 101；原用例失败，backlog `left: 3`、`right: 1` | `codex-s5-backlog-existing-test-reversed-20261001.log` |
| 恢复生产退账行 | 0；原用例 1 passed、0 failed | `codex-s5-backlog-existing-test-restored-20261001.log` |
| 原用例全部还原后，复跑原范围 | 0；5 passed、0 failed、4 ignored | `codex-s5-backlog-existing-tests-original-20261001.log` |

临时增强已全部还原，`git diff --exit-code -- apps/model-gateway/crates/agentgateway/src/telemetry/log_store_tests.rs` 退出 0；
Rust 1.95 的原文件 `rustfmt --check` 退出 0。默认并行 suite 不含这些临时全局计数断言，
本记录不声称交付了长期计数回归门禁。四项 PostgreSQL 用例本轮均按原规则跳过，不沿用历史通过冒充当前运行。
Gateway 镜像重建与生产用量归因不属于这四轮检查的完成声明。

修改前的 GitNexus 精确输出保存在 `codex-s5-backlog-fresh-preimpact-20261001.log`：
绑定 `kailo-plus`、工作树 `/volumes/kailo`、HEAD `ee4c79683453b0cdc45ca5a0668338b6f977c17c`，
index time `2026-10-01T03:27:39.697Z`；函数 LOW、父 File HIGH，原用例及其 File UNKNOWN。
UNKNOWN 已以实际测试模块加载和 backend 宏调用补证；没有把空调用集、LOW 或无 process 解释成全局无影响。

## Core 认证 ingress 与不可归因游标保留（2026-10-02）

本次在 producer 已存在之后实现 `core/crates/platform-core/src/gateway_usage.rs`，
以及 `20261002163000_gateway_usage_ingress.up.sql/.down.sql`。
依据是 `DD-21`、`.design/03` 的 `IngressCheckpoint` 和 §8、`.design/11` §4–6；
没有创建第二用量 outbox、Quota/余额账本、虚构 UsageEvent 或 OpenMeter publisher。

读取沿原管理端点 `GET /api/usage/outbox`，使用既有 `OIDC_SERVICE_CLIENT_ID` 的
`client_credentials`，不共享人或 Agent 的身份；URL 与超时取现有
`AGENTGATEWAY_ADMIN_URL` / `AGENTGATEWAY_ADMIN_TIMEOUT_SECONDS`。
调用 batch 来自既有治理对账配置，不内置新业务或调度上限。
认证拒绝会失效原 token 缓存，下一治理轮次重新认证；请求、token 获取与响应解码合计
受同一个管理超时约束。401/403、503、其它未知 HTTP 状态、超时、非法 JSON、
重复稳定 ID、非递增 seq、倒置完成时间或不匹配的 `nextCursor` 都保留游标、报 UNKNOWN；
不输出响应正文、认证 header 或上游 error 字段。

Core 的持久控制面只含 `source_key / tenant_id / cursor / updated_at`。
此流固定 `source_key=agentgateway-durable-usage-tail`、`tenant_id=NONE`；
初始 cursor 0 取自原生 after 省略语义，并非「零用量」。多 Core 副本对同一行
`FOR UPDATE SKIP LOCKED`，只有持锁副本读取，其他副本不改游标；崩溃释放事务锁，
下一轮重读同一 native ID。回滚迁移只接受这个尚未推进的初始 checkpoint，
已有其他流或已推进 cursor 时明确拒绝，不删除原生 outbox 或已消费进度。

当前 Core 仍没有 SS-COD-TRACE 的持久 trace→Session/Invocation/Operation 关联，
也没有 provider token/page→meter 的合法映射或 STRICT reservation producer。
`Ingress` 因此对任何非空页输出 `UNKNOWN / BILLING_UNAVAILABLE`，不保存 `nextCursor`；
仅成功读取空页输出「无适用对象」，不将空页、HTTP 失败或 native 通知当成计量/结算证明。
Core 仅解码 stable ID、seq 与开始/完成时间；attributes、模型配置、prompt/response
及原生用量正文均不复制入 Core。

代码产生以下实际读取信号，标签仅使用现有允许的 `outcome` 封闭集合：

- `platform.gateway_usage_ingress.passes`：EMPTY / BUSY / UNKNOWN；
- `platform.gateway_usage_ingress.unavailable`：该流不可核验或归因阻断；
- `platform.gateway_usage_ingress.pending_observed`：最后成功页的条数，不是全部 backlog 或计费用量；
- `platform.gateway_usage_ingress.oldest_observed_age`：该页最旧完成记录的年龄；
- `platform.gateway_usage_ingress.checkpoint_cursor`：持久 native seq，不是已结算用量。

同一治理对账 interval 是下一次检查期限，admin timeout 是持锁 HTTP 的上界；
持久事实补齐前没有自动过期、丢弃、跳过或伪终态。归因持续缺失逐轮告警，责任归
`07` §6 的 usage 缺口运维处置与 `RB-06-usage-and-audit-gaps.md` 的证据补录边界；
不得用随意拼接 operation 或手改 cursor 宣告收敛。这次没有新增永久业务状态。

### 已运行与未运行

`git rev-parse --show-toplevel` 输出 `/volumes/kailo/apps`。
`python3 tools/upstream_manifest.py status` 实际退出 0：Gateway 基准仍为
`1f7ebbf87cbdbe9517f6f181221879d04dc50692`，Codex 基准仍为
`7498521d288b9b3b96ffba4eedf089d8d6e06a84`，OpenMeter 基准仍为
`6d76d8a6fa90fbbab2d41035d31df2acec7ad3af`；Worker 上游领先信息另行报告，
没有据此升级本批依赖。

实现后的 `git diff --check` 没有输出；新文件的
`git diff --no-index --check /dev/null <file>` 均无 whitespace diagnostic，
退出 1 是新增文件与空文件不同，未将它写成退出 0。
此次未运行 SDK、格式器、编译、迁移、新库、真实 Gateway HTTP 或业务端到端；
尚未把代码指标当成已部署采集信号。主代理负责同一治理循环实际注册和集中验证。
本记录只证明源码已实现认证读取与 fail-closed checkpoint 边界，不证明
SS-COD-TRACE、OpenMeter UsageEvent、结算或 AgentTask 成功终态已经交付。

## Core Trace、UsageEvent 与原生 stored 观察源码切片（2026-10-02）

本节是上述 ingress 实现之后的独立源码窗口，不改写其历史运行结果。
依据为 DD-21/38/51/67、`.design/03` §8、`11` §3–6 与 `12` 的 Session context 边界。
本刀 before 原件在
`/volumes/data/kailo/tmp/codex-usage-next-before-20261002.E6JKyq/`；不把 HEAD 以来继承的
CHECK、Runtime、导航或其它队友增量计为本刀。公共生成物没有手改。

### 实际实现及影响面

- `agent_runtime.rs::Supervisor::start_turn` 消费真实 Invocation、Session/thread、固定
  version/generation、专属 Gateway SERVICE Principal、Capacity holder 和已登记 CHECK meters。
  原生 `thread/read` metadata 必须为同 thread 且 `status.type=idle`，不以历史首页证明实时空闲；
  `turn/start` 使用 Invocation ID 的 `clientUserMessageId`，JSON-RPC 顶层
  `trace.traceparent` 沿已有 SS-COD-TRACE fork 注入模型 HTTP 请求。
  Session 首次成功读取的 Core memory 仅以 transient `additionalContext` 的
  `platform.agent-memory.core`、`kind=untrusted` 传入，不拼入 input/developer instructions，
  不把正文存入 Core、Workflow history 或审计。
- `gateway_usage.rs::prepare_turn/dispatch_guard` 在原生模型副作用前持久 trace→同
  Invocation/operation/scope/Customer/subject/meter 引用和 AuditEvent；重试不换 trace 重发 turn。
  写前意图提交后再次持同 Tenant 生命周期行锁，回读固定 binding、generation、native meter
  与 Customer subject 映射，并 fresh 查询原生 credit。完整运行授权由调用方 fresh 闭包消费，
  不能用 Installation readiness 或 AE `ALLOWED` 单独代替 HUMAN/Delegation/Use/Approval 准入；
  该闭包不得再次获取已持有的 Tenant 锁。
- 认证 outbox 页只在 native stable ID、trace 和专属 user 都关联到同一写前事实时构造
  UsageEvent。数量只取 native `inputTokens/outputTokens/totalTokens` 中已登记 meter 的实际字段；
  缺计数不补零，不按 model、时间或 token 总量猜 meter/operation。Tenant、Workspace、
  Installation、Version 和 operation dimensions 只取 Core 冻结引用。原 attributes、cost、
  prompt/response 和 provider 配置正文不复制。
- `20261002210000_agent_model_usage` 只建技术因果投影及原 UsageEvent/outbox，保留
  `(tenant,source_type,source_id,meter_key)` 唯一键、固定 CloudEvent ID/body/time、同 scope
  trigger、原 native seq 与不可改写终态。页内所有 UsageEvent 与 checkpoint 同事务持久，
  缺归因则整页回滚、原游标保留。已有 outbox 仍单独收敛，不被后续坏页拖住；没有余额、
  plan、invoice 或严格额度的副本，未新增 QuotaReservation 或开放 STRICT。
- `openmeter.rs` 只消费固定 native Customer subject attribution 和原 Meter/credit。
  CHECK 原生 meter 采用可核验的 sum、三个已有 token 字段及受控 dimensions；逐 meter
  event_type 重复、feature filter 无法解析或 subject 不属于当前 Customer 均拒绝，不创造配置。
  原 `/openmeter/events` POST 的 202 仅为 ACCEPTED；先按固定 source/id/subject/type 查询，
  `stored_at` 才写 COMMITTED。UNKNOWN 重投保持原 ID/body，ACCEPTED 缺 stored 时继续查询。
  原生 DateTime 秒级存储和 UTC 拼写按固定源码回读精度比较，不修改首次投递时间；
  validation_errors/customer 的读时派生值不是落库判据，也不是账单 finalized 证据。
- 原 AuditEvent 与上述事实同事务写入，追加 UsageEvent/OpenMeter/Gateway log/trace 的封闭
  EvidenceKind、权威映射及共源文案；原 BFF evidence 路径继续 fresh audit scope 授权。
  Core 引用按同 Tenant/operation 查证；Gateway 引用回读 native seq 后核 stable ID/trace/user，
  OpenMeter 引用回读冻结事件的实际 stored_at。不能用 Core 副本证明 native 原对象还存在，
  权威源不可达回不可核验，不回退展示稳定 ID。

### 固定上游源码核验

- Gateway `1f7ebbf87cbdbe9517f6f181221879d04dc50692`：
  `crates/agentgateway/src/telemetry/log_store.rs::flush_log_store_batch` 原失败清批次事实；
  当前 apps 原生实现的同函数与 `log_store/postgres.rs::insert_batch` 保留已确认 outbox 消费。
  本刀未改 Gateway producer，未执行 `.references`，也不声称恢复写库前丢失的内存记录。
- Codex `7498521d288b9b3b96ffba4eedf089d8d6e06a84`：
  `codex-rs/app-server-protocol/src/rpc.rs::JSONRPCRequest` 的顶层 trace；
  `codex-rs/app-server-protocol/src/protocol/v2/thread.rs::ThreadStatus/ThreadReadParams`；
  `codex-rs/app-server-protocol/src/protocol/v2/turn.rs::TurnStartParams` 的 additional_context；
  `codex-rs/app-server/src/request_processors/thread_processor.rs::thread_turns_list_response_inner`
  明确存在“持久历史尚未包含当前活跃 turn”的窗口，因而本实现不用历史页代替实时 idle。
- OpenMeter `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af`：
  `api/v3/openapi.yaml` 的 Meter、MeteringEvent、MeteringIngestedEvent 和 events 路径；
  `api/v3/handlers/events/convert.go::toAPIMeteringIngestedEvent` 的读时转换；
  `openmeter/streaming/clickhouse/event_query.go::createEventsTable.toSQL` 的 time/stored_at
  为 DateTime 秒级；`InsertEventsQuery.ToSQL` 直接保存事件 time/data。

### 已运行与仍关闭的边界

本刀 `git rev-parse --show-toplevel` 实际输出 `/volumes/kailo/apps`，限定源码
`git diff --check` 实际退出 0、无输出。固定上游路径与符号由 `git show/git grep` 只读核对；
没有运行 SDK、生成器、格式器、编译、新迁移、新库、真实模型请求、OpenMeter 202/stored
或 Gateway HTTP，也未执行负向破坏核验；不把源码检查当业务验收。

本刀没有开放 Agent 运行入口或放宽原 `gateway_usage_not_closed` Catalog 约束。
HUMAN run ActionDefinition/Delegation 准入生产与 Invocation 实际生产没有在本刀贯通；
现有 Customer 创建只登记 Tenant key，Installation subject 需要真实 native
`usage_attribution.subject_keys` 关系，本实现缺此事实直接拒绝，不用完整 Customer PUT
覆盖账单/联系正文。native outbox 没有每 turn 的完成 watermark，读取空页或当前已观察
UsageEvent 全部 COMMITTED 均不证明请求全集、credit 吸收或 Invocation 可结算终态。
UNKNOWN 按既有治理 interval、admin timeout 和 RB-06 用量缺口责任边界持续对账，不丢弃、
不超时补零、不释放并重复执行。源码尚未提交、push、部署；上一个冻结批次 SDK 的结果
不作为本节验收。
