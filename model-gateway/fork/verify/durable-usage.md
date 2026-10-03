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

## 取消收敛与未确认投递纠偏（2026-10-03，源码实现后记录）

本刀依据仍为 DD-08/21/47/48/51、`.design/03` §7–8、`11` §2–4 和
`06-工程基线规范.md` §4；未建立第二个计量 outbox、额度余额、账单或审计权威。
精确实施前字节在
`/volumes/data/kailo/tmp/codex-agent-billing-window-20261003.cH0WCz/`，
不能把该目录的 before 与当前 HEAD 之间继承的改动计作本刀。

### 原因与实际影响

- 原 Task 的 CREATED 取消只进入 Capacity release，随后永久返回
  `BILLING_UNAVAILABLE`，没有业务取消终态。现在同 first-turn 的
  AE→Tenant→Invocation 锁内重新查证：同 scope/Workflow、CHECK 动作、无 native
  turn/status/reply、无 trace、无本 Invocation/operation 的 UsageEvent，才记录
  `CANCELED_BEFORE_MODEL_DISPATCH` 并写 CANCELED。不是伪造 native `interrupted`、
  零 token、零 UsageEvent 或已经派发的结算。
- paired `20261003010000_agent_cancel_before_dispatch` 扩展原取消 CHECK，另以触发器
  拒绝把 INSERT 或 DISPATCHING/UNKNOWN、有 trace/usage 的对象写成无 turn 取消。
  down 在存在这种真实终态时拒绝恢复旧约束，不删除事实或补假 native status。
  当前空白开发库没有旧 writer 兼容窗口；该状态只由新取消消费写入。
- Capacity 先消费上述确定无派发事实，不再因尚无 Session 而漏读；结束 holder
  不归还 units。原对账器确认确切 Run/Activity/attempt 的 Temporal terminal 后，
  与 native-release 证明一起写 RELEASED。租户删除只在相同事实仍存在、lease
  RELEASED 且两侧证据齐全时接受这个取消；仍要求原 Workflow/Task/run 投影一致、
  无 observation gap。原 native 失败、完成与 interrupted 分支没有改成状态标签放行。
- `Ingress::settle` 原 ACCEPTED 后只查询的分支已删除。固定 OpenMeter commit
  `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af` 的
  `openmeter/ingest/kafkaingest/collector.go::Collector.Ingest` 调用异步
  `Producer.Produce(msg, nil)`；同文件 `KafkaProducerGroup` 的之后投递失败只记日志。
  因此 202 不能保证之后可见 stored_at。读不到 stored_at 时重投原冻结的
  CloudEvent ID/source/time/body，复用原生去重，不重新执行模型；只有 stored_at
  才 COMMITTED。这仍不是 credit 已吸收或 invoice finalized。
- 同一 publisher 的既有循环提为 `gateway_usage::settle_events`，供实际 Memory
  读消费精确 UsageEvent ID。namespace 读取同 Event 的冻结字段；支持已有模型来源
  与 `BUZZ_AGENT_MEMORY`，未知 source 在外部 publish 前拒绝。202、缺 ID 或被另一个
  reconciler 持锁均不声明该读用量完成；Memory 的实际 source/AE/native head 审计和
  同表约束由对应消费者维护，不造 model trace 代替 HUMAN 读取。
- Gateway 原 `process_log_store_msg` 的 UsageOutbox 分支现在在
  `flush_log_store_batch=false` 时返回错误，不继续读旧页掩盖已知未确认批次。
  当前 admin 错误映射为 HTTP 500，未配置日志库仍为原 503；Core 非 200 均保留游标。
  `DropOnLog::drop` 的实际 `dtrace::with_trace` 是同步调用，之后 `emit` 进入内存队列，
  不是数据库 ack；这项纠偏不宣称每个 turn 请求全集已经完备。

### 失败边界、收敛与已运行范围

空 Session 只影响已确定无派发取消，不允许空 Gateway 页证明零模型用量。
重复 cancel/Activity retry 消费同 Invocation 与 lease；已持久派发意图或提交结果不明
只保留 UNKNOWN、按既有治理 interval/admin timeout 对账，不重发 turn、不释放未知 units。
租户暂停或成员撤权不授予新执行，只允许上述安全收尾；失败证据、未知枚举、缺关联、
scope/binding/secret/native 读取缺失仍映射既有 UNKNOWN 或拒绝，未渲染成功/失败。
负责收敛的仍是治理与 Capacity 对账器以及 RB-06 原用量缺口处置，不增加独立调度者。
Web/Desktop/Mobile 消费原 Task 状态与证据边界，没有新增运行或组件宿主入口。

本刀限定 `git diff --check` 实际退出 0、无输出；固定上游路径/符号以只读
`git show/git grep` 核验，未执行 `.references`。
本节写作时未运行 SDK、fmt/clippy、迁移/回退、replay、真实取消、Gateway HTTP、
OpenMeter publish/stored 或破坏还原；这些均跳过，不把源码检查或上一个批次结果记为验收。
正常已派发 turn 仍保持 `BILLING_UNAVAILABLE`，原生 durable dispatch/completion 完整性
生产证据不在本刀声称完成范围；STRICT 不开放。源码未提交、push 或部署。

### 同一源码切片的实际窄验证（2026-10-03）

以上“写作时未运行”保持为历史事实。本轮从 `67b48b7c027317efb59533ee9dcb5bc9b4a1a892`
导出 Data 私有候选，仅加入四个 Core 取消/publisher 消费文件、取消 paired 迁移、
Memory 同表 paired 迁移及它已实现的 `result_exposure` NONE/READ 枚举。
该独立枚举只用于命名数据库约束比对，当前没有 domain/api/workflow `$ref`；
未把另一 Delegation `ResultExposureMode` 或未选 Memory DTO 生成物混入本轮。
SDK 格式化后核验树为 `44fb5f59f88c54ceaa0a440bed40e35981274996`，
正式工作树与 Git 索引没有被 SDK 写入。

预检原构建进程与 CPU/内存 pressure 后，使用现有不可变 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`
及单独创建、只在 loopback 暴露的临时 PostgreSQL。
SDK 实际 UID:GID 为 1000:1000，`cpu.max=400000 100000`、
`memory.max=8589934592`、`memory.swap.max=0`，未设置或降低 Cargo jobs。
Cargo target 是 Data 独立目录，registry/git 缓存沿用原检查投递；没有连接业务库。
原始记录均位于
`/volumes/data/kailo/tmp/codex-agent-billing-window-20261003.cH0WCz/`：

| 实际阶段 | 结果与原件 |
|---|---|
| 首次原 fmt 检查 | 1；临时 launcher 漏格式化提取后的 publisher，`validation-first-fmt.log` / `sdk-first-fmt.log`；未执行 clippy 或数据库检查 |
| 格式化上述真实源后 | fmt/clippy 0；`validation-enum-failure.log` / `sdk-enum-failure.log` 保留同次原 migrate 的后续失败：库 NONE/READ 与所选旧枚举 NONE 不等 |
| 补齐现有独立枚举后的原 migrate | 0；前进、回退、再前进、原 `sqlx prepare --check`、44 个命名约束逐值相等；`validation.log` / `sdk.log`；未重复已通过 clippy |
| 两层显式回退再前进 | 0；`20261003020000` Memory 再 `20261003010000` 取消，随后两层重新应用；`sdk.log` / `migration-catalog.log` |
| 原 catalog 检查沿实际约束同步后 | 0；25 个 CHECK 标量边界、4 个启用的 scope/evidence trigger；`catalog-check.log` |
| 主动破坏与还原 | 同一事务删除实际 `catalog.agent_invocation.agent_invocation_check1` 后报 SQLSTATE 23514；rollback 后原检查重新 0；`catalog-check.log` |

续跑曾直接执行位于 noexec Data 的临时 launcher，被拒绝 126，保留
`validation-resume-launch-126.log`；改用 bash 投递，未改挂载权限或检查门禁。
最终 SDK `OOMKilled=false`、退出 0，本人临时 SDK/PG 容器已移除。
`catalog.agent_session`、`catalog.agent_invocation`、`admission.capacity_lease` 实际均为零对象。
本轮没有造 Tenant、Invocation、用户、meter 或 native 用量，也未执行真实取消、
Activity replay、Gateway producer/native HTTP、OpenMeter publish/stored、Memory BFF/UI
或正常已派发 turn 的结算验收。约束和编译通过不证明这些业务路径已完成。
没有重跑 full、生成四侧、重建发布产物、更新业务数据库、提交或部署；STRICT 与缺证据入口仍关闭。

## 正常 turn 的全集已提交用量消费（2026-10-03，实现后记录）

上一节取消切片的验证不作为本节新源码的验收。此独立窗口仅修改
`core/crates/platform-core/src/agent_task.rs` 与 `gateway_usage.rs`，
before 与完整差异保存在
`/volumes/data/kailo/tmp/codex-agent-billing-complete-window-20261003.v3gxqc/`。
`capacity.rs` 保持上一节已验证字节，没有新增迁移、契约或公开运行入口。

### 四步影响结论与实际调用

- 权威：DD-21/48/51、`.design/11` §3 CHECK、§4 Usage 幂等与 §6 审计证据，
  要求实际 native source、稳定 UsageEvent 和原生 `stored_at`；202 不作 COMMITTED，
  COMMITTED 不作余额快照已吸收或 invoice finalized。Gateway 基准仍为
  `1f7ebbf87cbdbe9517f6f181221879d04dc50692`，OpenMeter 为
  `6d76d8a6fa90fbbab2d41035d31df2acec7ad3af`，Codex 为
  `7498521d288b9b3b96ffba4eedf089d8d6e06a84`。
  本刀消费实际二开 `model-gateway/crates/agentgateway/src/telemetry/log_store.rs`
  的 `UsageOutboxResponse`、
  `model-gateway/crates/agentgateway/src/telemetry/log_store/postgres.rs::usage_outbox` 与
  `model-gateway/crates/agentgateway/src/telemetry/log_store/sqlite.rs::usage_outbox`
  原生请求集合快照，不从已收到的日志数量推测全集。
- 影响：原 Task completed 且回复已按固定事件 ID 查证、或 failed/interrupted，
  在 Capacity holder 已 RELEASED 且 native/Temporal 证据齐全后调用
  `gateway_usage::committed_turn`。其 `Ingress::completed_requests` 实际使用
  `RequestSet::absorb` 的分页裁决；逐页读取同 trace、专属 SERVICE identity、
  持久 attempt、稳定正数 submitted，以及 pending/untracked 为零的原生快照。
  短页不是结束，必须读到空页且唯一 ID 数覆盖全部 submitted。
  原 `correlate` 形成相同 SUM 事件，唯一已查证 Codex turn 形成独立 COUNT 事件，
  source/meter 集合必须与冻结 CHECK action 完全一致。全局历史 ingress 仍可读旧页，
  旧页缺完整性字段不能证明正常 turn 已结清。当前没有旧在线 writer 兼容窗口；
  Web/Desktop/Mobile 继续消费原 Task 状态和 evidence，不增加运行入口。
- 副作用：`settle_events` 复用同一 OpenMeter publisher 与稳定 CloudEvent 去重键，
  不创建第二账本。全部实际事件 COMMITTED 后，Task 再持 AE→Tenant→Invocation/lease
  原锁序，核对相同 scope、operation、native turn/status、回复、确切事件 ID 与
  RELEASED 双侧证据，才保存 Task 终态及原 Audit 引用。
  这是已发生执行的收尾，不因租户暂停或撤权授权新执行；计量重投只重投原事件，
  不调用 `turn/start`、不重签回复，不复制模型或协作正文。
- 异常：空集、缺页、分页总数变化、重复 ID、缺失或负 attempt、错 scope、未知枚举、
  缺 meter quantity、绑定变化、native 读取/提交不明均保持非终态；202 与未观察到
  `stored_at` 保持 BILLING_UNAVAILABLE，原 turn 和 outbox 留待既有对账器处理。
  已释放 holder 的观察不重新占 units。整体读取超时与批次分别来自现有 admin timeout
  与 `GOVERNANCE_RECONCILE_BATCH`，对账间隔和责任仍归原治理/Capacity 对账器及 RB-06，
  未新增硬编码时限、状态、调度者或金额权威。STRICT 和 invoice finalization 未开放。

### 实际窄验证、主动破坏与还原

复用 Memory 同一 feature 的 Data 私有快照
`/volumes/data/kailo/tmp/codex-memory-feature-sdk-20261003.sdcocM/apps`，
没有另起第三并行 SDK lane。原 `core-final/sdk.log` 的全 Core clippy 及
六项 `gateway_usage::usage_tests` 实际退出 0；原 rustfmt 从 `main.rs` 递归格式化了
本刀两源，不能声称其格式化前后 SHA 相同。

后续仍使用不可变 SDK
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
预检并回读 1000:1000、4 CPU、8 GiB、swap 0、Data 缓存，Cargo jobs 未设置或降低。
所有破坏只改上述私有快照的生产 guard，不改断言期待、不改正式生产 guard。
既有一项反例原本会被空页缺口遮蔽；已将原 total/pending/untracked 协议断言的其他字段
改为合法非空页，以下独立破坏实际证明它们能抓到目标缺失。没有业务 seed 或新检查脚本。

原始日志均在该目录的 `normal-turn-mutation/`：

| 实际阶段 | 原输出与退出码 |
|---|---|
| 原入口与独立 guard baseline | `baseline-original-entry.log`、`baseline-isolated-guards.log`：各 0，6 passed/0 failed |
| 短页当结束、移除跨页重复 ID/attempt 拒绝、ACCEPTED 当 COMMITTED | `mutation-short-duplicate-attempt-202.log`：101，6 个断言失败；包含无关反例也因错误短页终止被拒，不能算六个独立条件分别证明 |
| 空集当零用量证明 | `mutation-empty-set.log`：101，空集断言失败 |
| 缺页允许结束 | `mutation-missing-page.log`：101，缺页断言失败 |
| 总数跨页变化不拒绝 | `mutation-changing-total.log`：101，对应断言失败 |
| pending 不拒绝 | `mutation-pending.log`：101，对应断言失败 |
| untracked 不拒绝 | `mutation-untracked.log`：101，对应断言失败 |
| 精确还原后原窄检查 | `restored-final.log`：rustfmt、platform-core all-targets clippy 与原六项检查均 0；6 passed/0 failed |

每组差异留在同名 `.diff`，每次恢复均与 `guard-baseline.rs` 按字节比较为相同，
并保存 `restore-*.sha256`。最终验证 Task SHA 为
`e3ce724568f27e4ef80672f9a805edcbb833bdcd5b067ac3cbacf2b7978ffc11`，
usage 为 `5e2dba2e09872ed3bd6f805005b2f2a71632049e372ef0647688a2aa388d14ef`；
`source-proof-final.log` 在 SDK 内格式化正式两源后逐字节比较为相同。
最终 `restored-final.log` SHA 为
`f549b3c5272688cbac776075835441cf1845a8b00dd61b2760d02c356e0237bb`，
全部反例日志摘要保存在 `logs.sha256`。

首次来源比较直接使用带文件名头的 rustfmt stdout，`source-proof.log` 比较退出 1；
改为 stdin 输出后比较 0，未改变产品源。首次窄命令误带 `--lib`，
`baseline.log` / `baseline-exit.log` 保留 Cargo 101“no library targets found”；
续用原实际 binary 检查入口，不修改项目类型或门禁。
实际命令为 `cargo test --offline --manifest-path core/Cargo.toml -p platform-core gateway_usage::usage_tests -- --nocapture`。
OOM 计数均为零；验证命令终态 0 与常驻 `tail` 容器停止后的 ExitCode 137 分别记录，
`state-final.json` 的 OOMKilled 为 false，不把清理进程退出码冒充编译结果。
本人容器已移除，清理回执为 `cleanup-confirmed.log`。

重复 ID 断言只证明重复归因被拒，未执行真实 provider/Task 重投，不能据此宣称外部
调用次数验收。此次没有真实 Invocation、Gateway HTTP、OpenMeter publish/stored 或账单
业务验收；没有造业务对象、重复迁移、生成四侧、full、build/release、提交、push 或部署。
尚缺的合法运行/模型事实与 STRICT 能力仍保持关闭；不以协议反例或编译通过提升生产门禁。

## 2026-10-03 原生模型派发全集持久化

本段仅交付 Gateway 原生派发记录，不以它宣称 Core Invocation、Memory、模型调用或账单验收完成。
权威为 DD-21/48/51、SS-AGW-USAGE 与 `.design/11` §3–6；
固定上游为 `1f7ebbf87cbdbe9517f6f181221879d04dc50692`，
`crates/agentgateway/src/proxy/httpproxy.rs::make_backend_call` 和
`crates/agentgateway/src/telemetry/log.rs::RequestLog` 已以该 commit 的 `git grep` 重核。

影响面是原生 `make_backend_call → begin_usage_dispatch → log_store`、
SQLite/PostgreSQL 两后端、原 durable usage 查询和 native model-router 两种构造方。
副作用之前先持久化稳定 dispatch ID；无日志库或持久化失败则拒绝真正的 LLM 请求，
不把缺失记录当作成功。记录留在原生日志库，不成为第二 Quota、UsageEvent 或 Audit 权威，
不保存新的模型正文副本；非 LLM 仍走原非计量路径。

原接口新增 submitted/pending/untracked/request_set_complete 与 dispatch_attempt，
旧 entries/next_cursor 保持；已有记录没有派发证据时计为 untracked，
pending、跨 trace completion、未知或部分全集均不返回完整性证明。
未知外部结果保留原生待对账事实，不凭空页、当前已见记录或重复 completion 补成终态；
请求完成须匹配原 dispatch 与 trace。该全集只供消费者关联，不能代替 OpenMeter stored_at、
额度快照吸收或 invoice finalized。Native failover/model 解析复用原 ModelRouter 授权，
未配置 policy 不回退允许；local 与 xDS 构造方一同编译。

实现后实际命令（原生 SDK）：

```sh
cargo test --locked --profile ci -p agentgateway --lib telemetry::log_store::tests -- --test-threads=1
cargo test --locked --profile ci -p agentgateway --lib telemetry::log_store::tests::postgres_backend -- --ignored --test-threads=1
```

最终输出为 SQLite 5 passed、PostgreSQL 4 passed，退出码均 0；PG ignored 组由第二条命令实际执行，
没有把忽略当通过。实际工具链是原 Dockerfile 的 Rust 1.98.0；
SDK 镜像 `sha256:17a2ffedc7792a8dc0bfb17f34d6dd928db5efff67d5698d3c449cb6ffb94936`，
复用已有 4 CPU/8 GiB 配置、UID 1000，未设置或降低 Cargo jobs。
完整原日志、10 路径 SHA 与还原证据：
`/volumes/data/kailo/tmp/codex-gateway-dispatch-sdk-20261003.WESIVK/handoff.md`。

主动破坏实际 SQLite pending SQL 后断言失败、退出 101；精确还原后两后端 9 项通过。
再破坏 trace 匹配 SQL，实际断言失败、退出 101；精确还原后两后端 9 项通过。
两次都编译成功后才失败，未修改期望值；全部 SDK OOMKilled=false。
missing-global-log-store 分支已实际编译，但本组没有独立执行该分支；
不冒称 HTTP/provider E2E、当前部署、Core Task/Memory 终态或商业结算已验收。

### 本批构建与集中收口回执

原 `tools/build-upstream.sh model-gateway` 实际退出 0，registry 读回产物为
`sha256:471fa4e93689fc0a896b641decd94ca14fa7e76765899c6a8c1dea2c94e881ad`，
同一实际输入摘要为 `sha256:c9e6b4781f6032fdcab4e5440b038e6c01525f773518feb6f77ef231fc397768`。
构建原件 `codex-memory-billing-selected-20261003.w9pIBc/model-gateway-build.log`
SHA-256 为 `57c1634c65cb4b41de47d2311c9517c6975f9bdfa8d5b61b0582f7e0108f2327`。
本批没有重建未变的 Core、Worker 或三端产物。

正式 apps 根的原 `tools/check.sh --full` 对私有提交
`c609cf4e4281bb6537f9bdd735a0601788566e72`、固定树
`81d7ceb7026be5f6702726a368ded8dcbaee7a90` 实际退出 0，末行「全部通过」。
原件 `codex-gateway-delivery-20261003.2yDULc/full-corrected.log`
SHA-256 为 `ced6266629ab5d724b86f0343218d0dba07dbf730bcfbee21dede3b1591ad843`。
四侧生成、128 schema 兼容、原验证与 replay、18 条追溯、已有 18 份产物证明、
六份 seam 来源与实际 Gateway digest 指针均通过。
实际平台数据库演练和部署 `.env` 预检明确 SKIP；三项外部演练 ignored，
未安装 gitleaks，Win11/Mobile 签名及设备门禁仍阻断，不改记为业务或部署验收。

初轮完整检查退出 1：私有共享克隆的 Git alternates 在 SDK 中不可达，历史契约
读取退出 128，且未挂载现有 dist；Gateway 的 Compose 与两处 trace 指针仍为旧值。
原失败日志保留为同目录 `full.log`，SHA-256
`0d206cd2c2ae549e15c7371f21d4f16d7ffc6948072f2ef0259428e19fa4915f`。
随后只修真实来源指针，并由正式 apps Git 对象库与现有 dist 检查同一源码，
未重编译 Gateway，未补造 SBOM/provenance，未更改数据库或旧失败结论。
上述 full 在追加本节前形成；证据文档另走原文档快路径，不重复全量构建。

### 本批提交与单服务部署回执

2026-10-03 03:30 UTC，本批源码已提交并普通 push 为
`ab27c8ed5cd4cd4c0fda8e7748a18649cfbffde4`，远端 main 回读一致。
从正式 `deploy/local/compose.yaml` 只执行 Gateway 的 pull 和
`up -d --no-deps --no-build agentgateway`，没有重新构建 Gateway 或其他服务。
执行前原 Gateway 数据库、Keycloak 与 Web 均已 healthy；本次缩小更新范围不跳过依赖就绪条件。

新容器 `1b87f47b6e9a9555d6ceeb225eaa3fd546d2cae3bc235d5ee8b8e9f331b4e996`
实际运行产物 `sha256:471fa4e93689fc0a896b641decd94ca14fa7e76765899c6a8c1dea2c94e881ad`。
公开端保持本次实际配置的 `0.0.0.0:58090`，原生端仍是 `127.0.0.1:58091`；
这些是本次投递事实，不是业务源码缺省值。匿名 `/app/` 与 `/api/v1/session` 均实查 HTTP 302，
仍由原 OIDC 准入拒绝匿名业务访问。其他 23 个 Compose 服务的容器 ID、镜像、启动时间和状态
前后逐个比对完全相同；没有数据库重置、Core/Worker 更新或初始化重跑。

原件在 `codex-gateway-delivery-20261003.2yDULc/`：
`deploy-up.log` SHA-256 `bd644437d6da29fd04e968e34d218a7e55058e1da26fe3678139daff81603a46`；
`deploy-before.log` SHA-256 `1f09ea90dee17c6c98194c2c53785b369b5663fbccf19e395cc468c7f186c1b9`；
`deploy-after.log` SHA-256 `e0b23f9f56ae006db05ae0ac6f2cc4718b38af830ecfe6673d3a419fe71e728f`。
本回执仅证明这个产物的更新与匿名准入，未执行真实 provider/model/Memory/OpenMeter 业务链，
也不把另一批 Core Task/Memory 的未提交源码视为已部署。
